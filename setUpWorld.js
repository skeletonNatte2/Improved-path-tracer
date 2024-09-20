const BVH_MAX_DEPTH = 18;

const camPos = new Float32Array([-1, 1.5, -4.5]);
const camDir = new Float32Array([0.09, -0.2]);

var UP = false;
var DOWN = false;
var LEFT = false;
var RIGHT = false;
var W = false;
var A = false;
var S = false;
var D = false;
var SHIFT = false;
var SPACE = false;

var TRIANGLES = [];
var AABBS = [];
var MATERIALS = [];
var MESH_DATA = [];


class Material{
    constructor(){
        this.r = 1;
        this.g = 1;
        this.b = 1;
        this.emmissionStrength = 0;
        this.smoothness = 1;
        this.transparency = 0;
        this.refractiveIndex = 1.5;
        this.materialType = 1;
    }

    add(){
        MATERIALS.push([
            this.r,
            this.g,
            this.b,
            this.emmissionStrength,
            this.smoothness,
            this.transparency,
            this.refractiveIndex,
            this.materialType
        ]);
    }
}

class Triangle{
    constructor(){
        this.posA;
        this.posB;
        this.posC;
        this.normal;
        this.materialIdx;
    }
}

class AABBNode{
    constructor(){
        this.min = [Infinity,Infinity,Infinity];
        this.max = [-Infinity,-Infinity,-Infinity];
        this.startIdx = 0;
        this.endIdx = 0;
        this.childIdx = 0;
        this.depth = 0;

        this.index = 0;
    }

    add(){
        this.index = AABBS.length;
        AABBS.push(this);
    }

    getLongestAxis(){
        let axes = [0,1,2].map(i => this.max[i] - this.min[i]);
        let maxAxisLen = Math.max(axes[0], axes[1], axes[2]);
        if(maxAxisLen == axes[0]){
            return 0;
        }
        if(maxAxisLen == axes[1]){
            return 1;
        }
        if(maxAxisLen == axes[2]){
            return 2;
        }
    }

    includePoint(point){
        this.min = this.min.map((c, idx) => Math.min(c, point[idx]));
        this.max = this.max.map((c, idx) => Math.max(c, point[idx]));
    }

    includeTriangle(tri){
        this.includePoint(tri.posA);
        this.includePoint(tri.posB);
        this.includePoint(tri.posC);
    }

    split(depth = 0){
        if(depth == BVH_MAX_DEPTH || this.endIdx - this.startIdx < 3){
            return;
        }
    
        let childA = new AABBNode();
        let childB = new AABBNode();
        let triCountA = 0;
        let triCountB = 0;
        childA.startIdx = this.startIdx;
        childB.startIdx = this.startIdx;
    
        let axisIdx = this.getLongestAxis();
        let axisLen = this.max[axisIdx] - this.min[axisIdx];
        let dividingLine = this.min[axisIdx] + axisLen / 2;
    
        for(let i = this.startIdx; i < this.endIdx; i++){
            let tri = TRIANGLES[i];
            let center = (tri.posA[axisIdx]+tri.posB[axisIdx]+tri.posC[axisIdx])/3;
    
            if(center < dividingLine){
                childA.includeTriangle(tri);
                triCountA++;
    
                let swap = childA.startIdx + triCountA - 1;
                [TRIANGLES[i], TRIANGLES[swap]] = [TRIANGLES[swap], TRIANGLES[i]];
    
                childB.startIdx++;
            } else {
                childB.includeTriangle(tri);
                triCountB++;
            }
        }

        childA.depth = depth + 1;
        childB.depth = depth + 1;

        childA.endIdx = childA.startIdx + triCountA;
        childB.endIdx = childB.startIdx + triCountB;
    
        if(triCountA > 0 && triCountB > 0){
            childA.add();
            childB.add();
            AABBS[this.index].childIdx = childA.index;
            childA.split(depth + 1);
            childB.split(depth + 1);
        }
    }
}


class Mesh{
    constructor(fileText){
        this.fileText = fileText;
        
        this.scale = 1;
        this.shiftX = 0;
        this.shiftY = 0;
        this.shiftZ = 0;

        this.material = new Material();

        this.vertexIndices = [];
        this.vertices = [];
        this.triangles = [];

        this.boundingBox = new AABBNode();
    }

    getVertices(){
        let lines = this.fileText.split('\n');
        lines.forEach(line => {
            let data = line.trim().split(' ');
            if(data[0] == 'v'){
                let x = -this.scale * data[1] + this.shiftX;
                let y = this.scale * data[2] + this.shiftY;
                let z = -this.scale * data[3] + this.shiftZ;
                this.vertices.push([
                    x,
                    y,
                    z
                ]);
            }
        });
    }

    getFaces(){
        let lines = this.fileText.split('\n');
        lines.forEach(line => {
            let data = line.trim().split(' ');
            if(data[0] == 'f'){
                for(let i = 1; i < data.length; i++){
                    if(data[i].includes('/')){
                        data[i] = data[i].slice(0, data[i].indexOf('/'));
                    }
                }
                for(let i = 2; i < data.length - 1; i++){
                    this.vertexIndices.push([
                        1 * data[1],
                        1 * data[i],
                        1 * data[i+1]
                    ]);
                }
            }
        });
    }

    extractTriangles(){
        let l = this.vertexIndices.length;
        for(let i = 0; i < l; i++){
            let tri = new Triangle();
            let face = this.vertexIndices[i];
            let posA = this.vertices[face[0] - 1];
            let posB = this.vertices[face[1] - 1];
            let posC = this.vertices[face[2] - 1];
    
            let sideA = posB.map((c, index) => c - posA[index]);
            let sideB = posC.map((c, index) => c - posA[index]);
            
            let n = [];
            n.push(sideA[1] * sideB[2] - sideA[2] * sideB[1]);
            n.push(sideA[2] * sideB[0] - sideA[0] * sideB[2]);
            n.push(sideA[0] * sideB[1] - sideA[1] * sideB[0]);
            let nLeng = Math.sqrt(n[0]**2 + n[1]**2 + n[2]**2);
            n = n.map((c) => c / nLeng);

            let numMaterials = MATERIALS.length;

            tri.posA = posA;
            tri.posB = posB;
            tri.posC = posC;
            tri.normal = n;
            tri.materialIdx = numMaterials;
            
            this.triangles.push(tri);
        }
    }

    constructAABB(){
        this.boundingBox.startIdx = TRIANGLES.length;
        this.boundingBox.endIdx = this.boundingBox.startIdx + this.triangles.length;
        this.triangles.forEach(tri => {
            this.boundingBox.includeTriangle(tri);
        });
    }

    add(){
        this.getVertices();
        this.getFaces();
        this.extractTriangles();
        this.constructAABB();

        this.triangles.forEach(tri => {
            TRIANGLES.push(tri);
        });

        this.boundingBox.add();
        MESH_DATA.push(this.boundingBox.index);
        this.boundingBox.split();

        this.material.add();
    }
}

function setUpWorld(){
    /*for(let i = 0; i < NUM_BOUNDING_BOXES; i++){
        AABBS[i].split();
    }
    NUM_BOUNDING_BOXES = AABBS.length;*/

    MESH_DATA = new Uint32Array(MESH_DATA);

    for(let i = 0; i < TRIANGLES.length; i++){
        let tri = TRIANGLES[i];
        TRIANGLES[i] = [
            tri.posA,
            0,
            tri.posB,
            0,
            tri.posC,
            0,
            tri.normal,
            tri.materialIdx
        ];
    }
    TRIANGLES = TRIANGLES.flat(2);
    TRIANGLES = new Float32Array(TRIANGLES);

    for(let i = 0; i < NUM_BOUNDING_BOXES; i++){
        let bB = AABBS[i];
        AABBS[i] = [
            bB.min,
            bB.startIdx,
            bB.max,
            bB.endIdx,
            bB.childIdx,
            bB.depth,
            0,0 // padding
        ];
    }
    AABBS = AABBS.flat(2);
    AABBS = new Float32Array(AABBS);
    
    MATERIALS = MATERIALS.flat();
    MATERIALS = new Float32Array(MATERIALS);
}


let floor = new Mesh(ground);
floor.material.r = 0.5;
floor.material.g = 0.5;
floor.material.b = 0.5;
floor.add();

/*let dodecaMesh = new Mesh(dodecahedron);
dodecaMesh.shiftX = 1.5;
dodecaMesh.shiftY = 1.0;
dodecaMesh.shiftZ = 3.5;
dodecaMesh.scale = 1.0;
dodecaMesh.material.r = 0.8;
dodecaMesh.material.g = 0.8;
dodecaMesh.material.b = 0.8;
dodecaMesh.material.materialType = 2;
dodecaMesh.add();*/

/*let icosMesh = new Mesh(icosahedron);
icosMesh.shiftX = 0.25;
icosMesh.shiftY = 2.0;
icosMesh.shiftZ = 3.5;
icosMesh.scale = 1;
icosMesh.material.r = 0.9;
icosMesh.material.g = 0.9;
icosMesh.material.b = 0.9;
icosMesh.material.materialType = 2;
icosMesh.add();*/

/*let cubeMesh = new Mesh(cube);
cubeMesh.scale = 0.5;
cubeMesh.shiftX = 1.75;
cubeMesh.shiftY = 0.5;
cubeMesh.shiftZ = 1;
cubeMesh.material.r = 0.9;
cubeMesh.material.g = 0.9;
cubeMesh.material.b = 0.9;
cubeMesh.material.materialType = 2;
cubeMesh.add();*/

/*let treeMesh = new Mesh(tree2);
treeMesh.scale = 0.75;
treeMesh.shiftX = 1.25;
treeMesh.shiftY = -0.2;
treeMesh.shiftZ = 3.5;
treeMesh.material.r = 0.5;
treeMesh.material.g = 0.51;
treeMesh.material.b = 0.51;
treeMesh.material.smoothness = 0.9;
treeMesh.material.materialType = 2;
treeMesh.add();*/

let pawnMesh0 = new Mesh(pawn);
pawnMesh0.scale = 0.45;
pawnMesh0.shiftX = -0.75;
pawnMesh0.shiftZ = 3.75;
pawnMesh0.material.r = 0.05;
pawnMesh0.material.g = 0.05;
pawnMesh0.material.b = 0.05;
pawnMesh0.material.materialType = 3;
pawnMesh0.add();

let bishMesh = new Mesh(bishop);
bishMesh.scale = 0.09;
bishMesh.shiftX = 0.25;
bishMesh.shiftY = 0.01;
bishMesh.shiftZ = 0.75;
bishMesh.material.r = 0.6;
bishMesh.material.g = 0.62;
bishMesh.material.b = 0.62;
bishMesh.material.refractiveIndex = 1.65;
bishMesh.material.materialType = 4;
bishMesh.add();

let knightMesh = new Mesh(knight);
knightMesh.scale = 0.1;
knightMesh.shiftX = 3.0;
knightMesh.shiftY = 0.0;
knightMesh.shiftZ = 4.0;
knightMesh.material.r = 0.99;
knightMesh.material.g = 0.95;
knightMesh.material.b = 0.74;
//knightMesh.material.smoothness = 0.9;
knightMesh.material.materialType = 3;
knightMesh.add();

/*let bunnyMesh = new Mesh(rabbit);
bunnyMesh.material.r = 0.35;
bunnyMesh.material.g = 0.0;
bunnyMesh.material.b = 0.0;
bunnyMesh.material.materialType = 4;
bunnyMesh.scale = 0.5;
bunnyMesh.shiftX = 0.0;
bunnyMesh.shiftY = 1.05;
bunnyMesh.shiftZ = 1.5;
bunnyMesh.add();*/

/*let bunnyMesh2 = new Mesh(bunny);
bunnyMesh2.material.r = 0.35;
bunnyMesh2.material.g = 0.0;
bunnyMesh2.material.b = 0.0;
bunnyMesh2.material.materialType = 4;
bunnyMesh2.scale = 0.75;
bunnyMesh2.shiftX = 0.0;
bunnyMesh2.shiftY = 0.25;
bunnyMesh2.shiftZ = 1.5;
bunnyMesh2.add();*/

/*let birdMesh = new Mesh(finch);
birdMesh.material.r = 0.9;
birdMesh.material.g = 0.0;
birdMesh.material.b = 0.0;
birdMesh.shiftZ = 2.0;
birdMesh.material.materialType = 4;
birdMesh.scale = 18.0;
birdMesh.shiftY = 0.001;
birdMesh.add();*/


const NUM_TRIANGLES = TRIANGLES.length;
const NUM_MATERIALS = MATERIALS.length;
const NUM_MESHES = MESH_DATA.length;
var NUM_BOUNDING_BOXES = AABBS.length;
setUpWorld();

//document.getElementById('text').innerHTML = MESH_DATA;
