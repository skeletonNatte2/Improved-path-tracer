const BVH_MAX_DEPTH = 14;

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
                let x = this.scale * data[1] + this.shiftX;
                let y = this.scale * data[2] + this.shiftY;
                let z = this.scale * data[3] + this.shiftZ;
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
        //this.boundingBox.split();

        this.material.add();
    }
}

function setUpWorld(){
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
    
    for(let i = 0; i < AABBS.length; i++){
        let bB = AABBS[i];
        //document.getElementById('text').innerHTML += bB.childIdx + " ";
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


//createMesh(tree2,0.5,-0.75,-0.247,0.5);
//createMesh(tree,0.325,-3,0,0.4);
//createMesh(cat, 0.06);

let floor = new Mesh(ground);
floor.material.r = 0.5;
floor.material.g = 0.5;
floor.material.b = 0.5;
//floor.add();

/*let dodecaMesh = new Mesh(dodecahedron);
dodecaMesh.shiftX = -1.5;
dodecaMesh.shiftY = 1.75;
dodecaMesh.shiftZ = 1;
dodecaMesh.scale = 0.75;
dodecaMesh.material.r = 0.0;
dodecaMesh.material.g = 0.0;
dodecaMesh.material.b = 0.2;
dodecaMesh.material.materialType = 3;
dodecaMesh.add();*/

/*let icosMesh = new Mesh(icosahedron);
icosMesh.shiftX = 0.25;
icosMesh.shiftY = 0.85;
icosMesh.shiftZ = 3.5;
icosMesh.scale = 1;
icosMesh.material.r = 0.9;
icosMesh.material.g = 0.0;
icosMesh.material.b = 0.0;
icosMesh.material.materialType = 4;
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

/*let pawnMesh = new Mesh(pawn);
pawnMesh.scale = 0.5;
pawnMesh.shiftZ = 2;
pawnMesh.material.r = 0.9;
pawnMesh.material.g = 0.0;
pawnMesh.material.b = 0.0;
pawnMesh.material.materialType = 4;
pawnMesh.add();*/

let pawnMesh = new Mesh(pawn);
pawnMesh.scale = 0.5;
pawnMesh.shiftZ = 2;
pawnMesh.material.r = 0.989;
pawnMesh.material.g = 0.945;
pawnMesh.material.b = 0.735;
pawnMesh.material.smoothness = 0.6;
pawnMesh.material.materialType = 3;
pawnMesh.add();

/*let bunnyMesh = new Mesh(rabbit);
bunnyMesh.material.r = 0.1;
bunnyMesh.material.g = 0.1;
bunnyMesh.material.b = 0.1;
bunnyMesh.material.materialType = 3;
bunnyMesh.scale = 0.75;
bunnyMesh.shiftY = 0.9;
bunnyMesh.add();*/

/*let birdMesh = new Mesh(finch);
birdMesh.material.r = 0.9;
birdMesh.material.g = 0.0;
birdMesh.material.b = 0.0;
birdMesh.material.materialType = 4;
birdMesh.scale = 18.0;
birdMesh.shiftY = 0.001;
birdMesh.add();*/


const NUM_TRIANGLES = TRIANGLES.length;
const NUM_BOUNDING_BOXES = AABBS.length;
const NUM_MATERIALS = MATERIALS.length;
setUpWorld();

//document.getElementById('text').innerHTML = NUM_TRIANGLES;
