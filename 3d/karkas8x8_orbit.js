import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8aa3b5);
scene.fog = new THREE.Fog(0x8aa3b5, 28, 70);

const camera = new THREE.PerspectiveCamera(50, 1, 0.08, 200);
camera.position.set(-11, 8.5, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(4, 1.6, 4);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 45;

scene.add(new THREE.AmbientLight(0xfff4e6, 0.55));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.35);
sun.position.set(-12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
sun.shadow.camera.right = sun.shadow.camera.top = 18;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9ec5e8, 0x4a3f30, 0.35));

const G = {
  piles: new THREE.Group(), grillage: new THREE.Group(), walls: new THREE.Group(),
  braces: new THREE.Group(), parts: new THREE.Group(), openings: new THREE.Group(),
  roofframe: new THREE.Group(), roof: new THREE.Group(), sip: new THREE.Group(),
  labels: new THREE.Group(), ground: new THREE.Group()
};
Object.values(G).forEach(g => scene.add(g));
