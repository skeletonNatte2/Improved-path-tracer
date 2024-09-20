const renderModuleCode = /*wgsl*/`


@group(0) @binding(0) var mySampler : sampler;
@group(0) @binding(1) var myTexture : texture_2d<f32>;

@vertex fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
    let pos = array(
        vec2f( 1.0,  1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0, -1.0),
        vec2f( 1.0,  1.0),
        vec2f(-1.0, -1.0),
        vec2f(-1.0,  1.0),
    );

    return vec4f(pos[vertexIndex],0,1);
}


@fragment fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let output = textureSample(myTexture, mySampler, vec2f(pixel.xy) / ${ CANVAS_WIDTH } );
    return output;
}
`

const computeModuleCode = /*wgsl*/`


struct SimData{
    dimensions: vec2f,
    frame: f32,
}

struct Ray{
    origin: vec3f,
    dir: vec3f,
    color: vec3f,
}

struct Material{
    color: vec3f,
    emmissionStrength: f32,
    smoothness: f32,
    transparency: f32,
    refractiveIndex: f32,
    materialType: f32,
}

struct Triangle{
    posA: vec3f,
    posB: vec3f,
    posC: vec3f,
    normal: vec3f,
    materialIdx: f32,
}

struct AABB{
    min: vec3f,
    startIdx: f32,
    max: vec3f,
    endIdx: f32,
    childIdx: f32,
    depth: f32,
}

struct HitInfo{
    didHit: bool,
    dist: f32,
    pos: vec3f,
    normal: vec3f,
    material: Material,
}

const groundColor = vec3f(0.6723941, 0.95839283, 1.0);
const horizonColor = vec3f(0.6523941, 0.93839283, 1.0);
const skyColor = vec3f(0.2788092, 0.56480793, 0.9264151);
const sunDir = normalize(vec3f(-0.3, 0.6, 1.0));
const sunFocus = 500.0;
const sunIntensity = 150.0;

@group(0) @binding(0) var outputTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var inputTexture : texture_2d<f32>;
@group(0) @binding(2) var<uniform> camAngle: vec2f;
@group(0) @binding(3) var<uniform> camPos: vec3f;
@group(0) @binding(4) var<uniform> simData: SimData;
@group(0) @binding(5) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(6) var<storage, read> boundingBoxes: array<AABB>;
@group(0) @binding(7) var<uniform> materials: array<Material,${ NUM_MATERIALS }>;
@group(0) @binding(8) var<storage, read> meshes: array<u32,${ NUM_MESHES }>;


fn random(state: ptr<function, u32>) -> f32 {
    let oldState = *state + 747796405u + 2891336453u;
    let word = ((oldState >> ((oldState >> 28u) + 4u)) ^ oldState) * 277803737u;
    *state = (word >> 22u) ^ word;
    return f32(*state) / 0xffffffff;
}

fn randomNormDist(state: ptr<function, u32>) -> f32 {
    var theta = 6.283185307 * random(state);
    var rho = sqrt(-2 * log(random(state)));
    return rho * cos(theta);
}

fn randomDir(state: ptr<function, u32>) -> vec3f {
    var x = randomNormDist(state);
    var y = randomNormDist(state);
    var z = randomNormDist(state);

    return normalize(vec3f(x, y, z));
}

fn rayAABBIntersect(ray: Ray, box: AABB) -> f32 {
    let tbot = (box.min - ray.origin) / ray.dir;
    let ttop = (box.max - ray.origin) / ray.dir;

    let tmin = min(ttop, tbot);
    let tmax = max(ttop, tbot);
    let tNear = max(max(tmin.x, tmin.y), tmin.z);
    let tFar = min(min(tmax.x, tmax.y), tmax.z);
    
    let hit = tFar >= tNear && tFar > 0.0;
    let dist = select(0x1.fffffep+127f, max(tNear,0.0), hit);

    return dist;
}

fn rayTriangleIntersect(ray: Ray, tri: Triangle) -> HitInfo {
    var thisHit: HitInfo;
    thisHit.didHit = false;

    let vertexA = tri.posA;
    let vertexB = tri.posB;
    let vertexC = tri.posC;
    let n = tri.normal;

    let denom = dot(n, ray.dir);
    if(denom == 0.0){
        return thisHit;
    }

    let t = dot(vertexA - ray.origin, n) / denom;
    if(t <= 0.0){
        return thisHit;
    }
    let hitPos = ray.origin + ray.dir * t;

    let edgeAB = vertexB - vertexA;
    let edgeBC = vertexC - vertexB;
    let edgeCA = vertexA - vertexC;

    let c0 = dot(cross(edgeAB, hitPos - vertexA), n);
    let c1 = dot(cross(edgeBC, hitPos - vertexB), n);
    let c2 = dot(cross(edgeCA, hitPos - vertexC), n);

    if (c0 <= 0.0 || c1 <= 0.0 || c2 <= 0.0) {
        return thisHit;
    }

    thisHit.dist = t;
    thisHit.pos = hitPos;
    thisHit.normal = n;
    thisHit.didHit = true;
    thisHit.material = materials[u32(tri.materialIdx)];
    return thisHit;
}

// Create hit info for a ray and the whole scene

fn traceRay(ray: Ray, meshIdx: u32) -> HitInfo {
    var closestHit: HitInfo;
    closestHit.dist = 0x1.fffffep+127f;
    closestHit.didHit = false;
    var thisHit: HitInfo;

    var stack: array<u32,${ BVH_MAX_DEPTH }>;
    var stackIdx: u32 = 1;
    stack[0] = meshIdx;
    /*for(var i = 0; i < ${ NUM_BOUNDING_BOXES }; i += 1){
        if(boundingBoxes[u32(i)].depth == 0.0){
            stack[stackIdx] = u32(i);
            stackIdx += 1;
        }
    }*/
    /*while(true){
        if(boundingBoxes[stackIdx].depth == 0.0){
            stack[stackIdx] = stackIdx;
            stackIdx += 1;
        } else {
            break;
        }
    }*/

    while(stackIdx > 0){
        stackIdx -= 1;
        let bb = boundingBoxes[stack[stackIdx]];

        if(bb.childIdx == 0){
            for(var i = bb.startIdx; i < bb.endIdx; i += 1){
                thisHit = rayTriangleIntersect(ray, triangles[u32(i)]);
                if(thisHit.didHit && thisHit.dist < closestHit.dist){
                    closestHit = thisHit;
                }
            }
        } else {
            let childAIdx = u32(bb.childIdx);
            let childBIdx  = childAIdx + 1;

            let distA = rayAABBIntersect(ray, boundingBoxes[childAIdx]);
            let distB = rayAABBIntersect(ray, boundingBoxes[childBIdx]);

            let childAClosest = distA < distB;

            if(select(distA, distB, childAClosest) < closestHit.dist){
                stack[stackIdx] = select(childAIdx, childBIdx, childAClosest);
                stackIdx += 1;
            }
            if(select(distB, distA, childAClosest) < closestHit.dist){
                stack[stackIdx] = select(childBIdx, childAIdx, childAClosest);
                stackIdx += 1;
            }
        }
    }

    
    /*let bb = boundingBoxes[0];
    if(rayAABBIntersect(ray,bb) > -1.0){
        for(var i = bb.startIdx; i < bb.endIdx; i += 1){
            thisHit = rayTriangleIntersect(ray, triangles[u32(i)]);
            if((thisHit.didHit && thisHit.dist < closestHit.dist) || !closestHit.didHit){
                closestHit = thisHit;
            }
        }
    }*/

    return closestHit;
}

fn getSky(ray: Ray) -> vec3f {
    let skyGradientT = pow(smoothstep(0.0, 0.4, ray.dir.y),0.35);
    let skyGradient = mix(horizonColor, skyColor, skyGradientT);
    let sun = pow(max(0.0, dot(ray.dir, sunDir)), sunFocus) * sunIntensity;

    let groundToSky = smoothstep(-0.01, 0.0, ray.dir.y);
    var sunMask = 0.0;
    if(groundToSky >= 1.0){
        sunMask = 1.0;
    }

    return mix(groundColor, skyGradient, groundToSky) + sun * sunMask;
}


@compute @workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) globalInvocationID: vec3u){
    let pos = globalInvocationID.xy;
    let pixel = vec2f(pos);

    let frame = simData.frame;

    let screenSize = simData.dimensions.x;
    let texCoords = vec2u(pixel);
    let pixelIndex = texCoords.x + ${ CANVAS_WIDTH } * texCoords.y;
    let planeDist = 1.0;

    var rngState = pixelIndex + u32(frame) * 719324593u;

    let rotMatX = mat3x3f(
        1.0, 0.0, 0.0,
        0.0, cos(camAngle.x), -sin(camAngle.x),
        0.0, sin(camAngle.x), cos(camAngle.x)
    );
    let rotMatY = mat3x3f(
        cos(camAngle.y), 0.0, sin(camAngle.y),
        0.0, 1.0, 0.0,
        -sin(camAngle.y), 0.0, cos(camAngle.y)
    );

    /*var planePos = vec3f(
        pixel.x / screenSize - 0.5,
        pixel.y / -screenSize + 0.5, 
        planeDist
    );*/
    var planePos: vec3f;

    let numBounces = 100;
    let numRays = 1;

    var averageLight = vec3f(0.0);
    var ray: Ray;
    var totalLight: vec3f;

    for(var i = 0; i < numRays; i += 1){

        planePos = vec3f(
            (pixel.x + random(&rngState) - 0.5) / screenSize - 0.5,
            (pixel.y + random(&rngState) - 0.5) / -screenSize + 0.5, 
            planeDist
        );

        ray.origin = camPos;
        ray.dir = normalize(rotMatY * rotMatX * planePos);
        ray.color = vec3f(1.0);

        totalLight = vec3f(0.0);
        
        for(var j = 0; j < numBounces; j += 1){

            var traceResults: HitInfo;
            traceResults.didHit = false;
            traceResults.dist = 0x1.fffffep+127f;

            for(var m = 0; m < ${ NUM_MESHES }; m += 1){
                let idx = meshes[u32(m)];
                if(rayAABBIntersect(ray,boundingBoxes[idx]) < traceResults.dist){
                    let hit = traceRay(ray,idx);
                    if(hit.dist < traceResults.dist){
                        traceResults = hit;
                    }
                }
            }
            
            if(!traceResults.didHit){
                totalLight += getSky(ray) * ray.color;
                break;
            }

            let material = traceResults.material;
            let materialType = i32(material.materialType);

            switch materialType {
                case 2: {
                    let rayIsInside = select(1.0,-1.0,dot(ray.dir,traceResults.normal) > 0.0);
                    let n = traceResults.normal * rayIsInside;
                    let specularDir = reflect(ray.dir, n);
                    let diffuseDir = normalize(n + randomDir(&rngState));
                    ray.dir = mix(diffuseDir, specularDir, material.smoothness);
                    ray.origin = traceResults.pos + ray.dir * 0.001;

                    let emitted = material.color * material.emmissionStrength;
                    totalLight += emitted * ray.color;
                    ray.color *= material.color;
                }
                case 3: {
                    let indRef = material.refractiveIndex;
                    let rayIsInside = select(1.0,-1.0,dot(ray.dir,traceResults.normal) > 0.0);
                    let n = traceResults.normal * rayIsInside;

                    let cosTheta1 = dot(n,-ray.dir);
                    let cosTheta2 = sqrt(1 - (1 - cosTheta1 * cosTheta1) / (indRef * indRef));

                    let fp = (indRef * cosTheta1 - cosTheta2) / (indRef * cosTheta1 + cosTheta2);
                    let fs = (cosTheta1 - indRef * cosTheta2) / (cosTheta1 + indRef * cosTheta2);

                    var reflectance = 0.5 * (fp * fp + fs * fs);
    
                    var newDir = n + randomDir(&rngState);
                    var hitColor = material.color;
                    if(reflectance >= random(&rngState)){
                        newDir = mix(newDir, reflect(ray.dir, n), material.smoothness);
                        hitColor = vec3f(1.0);
                    }
    
                    ray.dir = normalize(newDir);
                    ray.origin = traceResults.pos + ray.dir * 0.001;
    
                    var emitted = material.color * material.emmissionStrength;
                    totalLight += emitted * ray.color;
                    ray.color *= hitColor;
                }
                case 4: {
                    let indRef = material.refractiveIndex;
                    let rayIsInside = select(1.0,-1.0,dot(ray.dir,traceResults.normal) > 0.0);
                    let indRefsRatio = select(1.0 / indRef,indRef,rayIsInside == -1.0);
                    let n = traceResults.normal * rayIsInside;

                    let cosTheta1 = dot(n,-ray.dir);
                    let cosTheta2 = sqrt(1 - (1 - cosTheta1 * cosTheta1) * indRefsRatio * indRefsRatio);

                    let fp = (cosTheta1 - cosTheta2 * indRefsRatio) / (cosTheta1 + cosTheta2 * indRefsRatio);
                    let fs = (cosTheta1 * indRefsRatio - cosTheta2) / (cosTheta1 * indRefsRatio + cosTheta2);

                    var reflectance = 0.5 * (fp * fp + fs * fs);
    
                    var newDir = refract(ray.dir,n,indRefsRatio);
                    var hitColor = vec3f(1.0);
                    if(length(newDir) < 0.1 || reflectance >= random(&rngState)){
                        newDir = reflect(ray.dir, n);
                    } else if(rayIsInside == -1.0){
                        hitColor = material.color;
                    }
    
                    ray.dir = normalize(newDir);
                    ray.origin = traceResults.pos + ray.dir * 0.001;
    
                    var emitted = material.color * material.emmissionStrength;
                    totalLight += emitted * ray.color;
                    ray.color *= hitColor;
                }
                default {
                    let rayIsInside = select(1.0,-1.0,dot(ray.dir,traceResults.normal) > 0.0);
                    let n = traceResults.normal * rayIsInside;

                    let diffuseDir = normalize(n + randomDir(&rngState));
                    ray.dir = diffuseDir;
                    ray.origin = traceResults.pos + ray.dir * 0.001;

                    let emitted = material.color * material.emmissionStrength;
                    totalLight += emitted * ray.color;
                    ray.color *= material.color;
                }
            }
        }
        averageLight += totalLight;
    }

    var previousColor = vec3f(textureLoad(inputTexture, pos, 0).xyz);
    averageLight = sqrt(max(averageLight / f32(numRays), vec3f(0.0)));
    let weight = 1.0/frame;
    averageLight = weight * averageLight + (1.0 - weight) * previousColor;
    textureStore(outputTexture, pos, vec4f(averageLight, 1.0));
}
`