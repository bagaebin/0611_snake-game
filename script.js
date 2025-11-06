import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const container = document.getElementById('game-container');
const scoreEl = document.getElementById('score-value');
const statusEl = document.getElementById('input-status');
const permissionButton = document.getElementById('permission-button');

const gridSize = 64;
const tileSize = 1;
const halfGrid = (gridSize * tileSize) / 2;
const frustumSize = gridSize * tileSize;

const snake = {
  segments: [],
  direction: new THREE.Vector3(1, 0, 0),
  targetDirection: new THREE.Vector3(1, 0, 0),
  speed: 8,
  segmentLength: tileSize,
  segmentHeight: tileSize * 0.55,
  pathPositions: [],
  pathDistances: [],
};

const coin = {
  mesh: null,
  active: false,
  cell: null,
  nextSpawn: performance.now() + 3000,
  interval: 5000,
};

const inputState = {
  orientationSupported: false,
  orientationVector: new THREE.Vector3(),
  keyboardVector: new THREE.Vector2(),
};

let scene, camera, renderer;
let lastFrameTime = performance.now();
let score = 0;

initScene();
initInput();
startGame();
renderer.setAnimationLoop(animate);

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050d1f, 40, 180);

  const aspect = container.clientWidth / container.clientHeight || 1;
  camera = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    500
  );
  camera.position.set(80, 90, 80);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x050d1f, 1);
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xfff3d6, 0.8);
  directional.position.set(60, 120, 40);
  scene.add(directional);

  createGrid();

  window.addEventListener('resize', onWindowResize);
}

function createGrid() {
  const floorGeometry = new THREE.PlaneGeometry(gridSize * tileSize, gridSize * tileSize, gridSize, gridSize);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2d4a, metalness: 0.15, roughness: 0.75 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = false;
  scene.add(floor);

  const gridHelper = new THREE.GridHelper(gridSize * tileSize, gridSize, 0x6bc8ff, 0x2a4e74);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);
}

function clampPositionToGrid(position) {
  const limit = halfGrid - tileSize * 0.5;
  position.x = THREE.MathUtils.clamp(position.x, -limit, limit);
  position.z = THREE.MathUtils.clamp(position.z, -limit, limit);
  return position;
}

function initInput() {
  if (typeof DeviceOrientationEvent !== 'undefined') {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      permissionButton.hidden = false;
      statusEl.textContent = '센서 사용을 허용해주세요.';
      permissionButton.addEventListener('click', async () => {
        try {
          const response = await DeviceOrientationEvent.requestPermission();
          if (response === 'granted') {
            attachOrientationListener();
            permissionButton.hidden = true;
            statusEl.textContent = '기기를 기울여 조작하세요.';
          } else {
            statusEl.textContent = '센서 권한이 거부되었습니다. 화살표 키를 사용하세요.';
            inputState.orientationSupported = false;
          }
        } catch (err) {
          console.error(err);
          statusEl.textContent = '센서 권한 요청에 실패했습니다. 화살표 키를 사용하세요.';
        }
      });
    } else {
      attachOrientationListener();
      statusEl.textContent = '기기를 기울여 조작하세요.';
    }
  } else {
    statusEl.textContent = '센서를 지원하지 않습니다. 화살표 키로 조작하세요.';
  }

  window.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        inputState.keyboardVector.y = -1;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        inputState.keyboardVector.y = 1;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        inputState.keyboardVector.x = -1;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        inputState.keyboardVector.x = 1;
        break;
      default:
        return;
    }
    statusEl.textContent = inputState.orientationSupported
      ? '기울기로 조작 중 (키보드 보조 입력 가능)'
      : '화살표 키로 조작 중';
  });

  window.addEventListener('keyup', (event) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        if (inputState.keyboardVector.y === -1) inputState.keyboardVector.y = 0;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        if (inputState.keyboardVector.y === 1) inputState.keyboardVector.y = 0;
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        if (inputState.keyboardVector.x === -1) inputState.keyboardVector.x = 0;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        if (inputState.keyboardVector.x === 1) inputState.keyboardVector.x = 0;
        break;
      default:
        return;
    }
  });
}

function attachOrientationListener() {
  window.addEventListener(
    'deviceorientation',
    (event) => {
      const beta = THREE.MathUtils.clamp(event.beta ?? 0, -70, 70);
      const gamma = THREE.MathUtils.clamp(event.gamma ?? 0, -70, 70);
      const betaRad = THREE.MathUtils.degToRad(beta);
      const gammaRad = THREE.MathUtils.degToRad(gamma);

      const xTilt = Math.sin(gammaRad);
      const zTilt = -Math.sin(betaRad);
      const magnitude = Math.hypot(xTilt, zTilt);
      const deadZone = 0.08;

      if (magnitude > deadZone) {
        inputState.orientationVector.set(xTilt, 0, zTilt).normalize();
      } else {
        inputState.orientationVector.setScalar(0);
      }

      if (!inputState.orientationSupported) {
        statusEl.textContent = '기기를 기울여 조작하세요.';
      }
      inputState.orientationSupported = true;
    },
    true
  );
}

function startGame() {
  clearSnake();
  score = 0;
  updateScore();

  if (coin.mesh) {
    coin.mesh.visible = false;
  }
  coin.active = false;

  const startCell = getRandomEmptyCell();
  const startPosition = cellToPosition(startCell);
  snake.direction.set(1, 0, 0);
  snake.targetDirection.set(1, 0, 0);

  const head = createSegment(0xff7a59, 0x6e2416, 0.6);
  head.position.copy(startPosition);
  head.position.y = snake.segmentHeight / 2;
  clampPositionToGrid(head.position);
  scene.add(head);
  snake.segments.push(head);

  snake.pathPositions = [head.position.clone()];
  snake.pathDistances = [0];

  coin.nextSpawn = performance.now() + coin.interval;
}

function clearSnake() {
  snake.segments.forEach((segment) => scene.remove(segment));
  snake.segments = [];
  snake.pathPositions = [];
  snake.pathDistances = [];
}

function createSegment(color, emissive = 0x000000, emissiveIntensity = 0.4) {
  const geometry = new THREE.BoxGeometry(
    snake.segmentLength * 0.85,
    snake.segmentHeight,
    snake.segmentLength * 0.85
  );
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.32,
    metalness: 0.12,
  });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

function animate(now) {
  const deltaMs = now - lastFrameTime;
  const delta = Math.min(deltaMs / 1000, 0.05);
  lastFrameTime = now;

  resolveInputDirection();
  snake.direction.lerp(snake.targetDirection, 0.12);
  if (snake.direction.lengthSq() > 0) {
    snake.direction.normalize();
  }

  moveSnake(delta);
  updateSegments();
  updateCoin(delta, now);

  renderer.render(scene, camera);
}

function resolveInputDirection() {
  const orientationVec = inputState.orientationVector;
  const keyboardVec = inputState.keyboardVector;

  if (orientationVec.lengthSq() > 0) {
    snake.targetDirection.copy(orientationVec);
  } else if (keyboardVec.lengthSq() > 0) {
    snake.targetDirection.set(keyboardVec.x, 0, keyboardVec.y).normalize();
  }
}

function moveSnake(delta) {
  if (snake.segments.length === 0) return;
  const head = snake.segments[0];
  const velocity = snake.direction.clone().multiplyScalar(snake.speed * delta);
  if (velocity.lengthSq() === 0) return;

  const newPosition = head.position.clone().add(velocity);
  constrainToGrid(newPosition, head.position);
  head.position.copy(newPosition);
  snake.pathPositions.push(head.position.clone());

  const prevDistance = snake.pathDistances[snake.pathDistances.length - 1] ?? 0;
  const addedDistance = snake.pathPositions.length > 1
    ? snake.pathPositions[snake.pathPositions.length - 2].distanceTo(head.position)
    : 0;
  const newDistance = prevDistance + addedDistance;
  snake.pathDistances.push(newDistance);

  trimPathBuffer(newDistance);

  const headingAngle = Math.atan2(snake.direction.x, snake.direction.z);
  head.rotation.set(0, headingAngle, 0);
}

function constrainToGrid(position, previousPosition) {
  const limit = halfGrid - tileSize * 0.5;
  if (position.x > limit) {
    position.x = limit;
    snake.direction.x = Math.min(snake.direction.x, 0);
    snake.targetDirection.x = snake.direction.x;
  } else if (position.x < -limit) {
    position.x = -limit;
    snake.direction.x = Math.max(snake.direction.x, 0);
    snake.targetDirection.x = snake.direction.x;
  }

  if (position.z > limit) {
    position.z = limit;
    snake.direction.z = Math.min(snake.direction.z, 0);
    snake.targetDirection.z = snake.direction.z;
  } else if (position.z < -limit) {
    position.z = -limit;
    snake.direction.z = Math.max(snake.direction.z, 0);
    snake.targetDirection.z = snake.direction.z;
  }

  clampPositionToGrid(position);
  position.y = previousPosition.y;
}

function trimPathBuffer(currentDistance) {
  const maxDistance = snake.segmentLength * (snake.segments.length - 1) + 0.5;
  while (snake.pathDistances.length > 1 && snake.pathDistances[1] < currentDistance - maxDistance) {
    snake.pathDistances.shift();
    snake.pathPositions.shift();
  }
}

function updateSegments() {
  if (snake.segments.length <= 1) return;
  const totalDistance = snake.pathDistances[snake.pathDistances.length - 1] ?? 0;

  for (let i = 1; i < snake.segments.length; i++) {
    const targetDistance = Math.max(0, totalDistance - snake.segmentLength * i);
    const position = getPositionAlongPath(targetDistance);
    snake.segments[i].position.copy(position);
    clampPositionToGrid(snake.segments[i].position);

    const previousPosition = getPositionAlongPath(
      Math.min(totalDistance, Math.max(0, targetDistance + 0.01))
    );
    const dir = previousPosition.clone().sub(position);
    if (dir.lengthSq() > 0.0001) {
      dir.normalize();
      const angle = Math.atan2(dir.x, dir.z);
      snake.segments[i].rotation.set(0, angle, 0);
    }
  }
}

function getPositionAlongPath(targetDistance) {
  const positions = snake.pathPositions;
  const distances = snake.pathDistances;
  if (positions.length === 0) return new THREE.Vector3();

  if (targetDistance <= distances[0]) {
    return positions[0].clone();
  }

  for (let i = 1; i < distances.length; i++) {
    const current = distances[i];
    const previous = distances[i - 1];
    if (targetDistance <= current) {
      const span = current - previous;
      const t = span === 0 ? 0 : (targetDistance - previous) / span;
      return positions[i - 1].clone().lerp(positions[i], t);
    }
  }

  return positions[positions.length - 1].clone();
}

function updateCoin(delta, now) {
  if (coin.active && coin.mesh) {
    coin.mesh.rotation.y += 1.5 * delta;
    checkCoinCollision();
  } else if (now >= coin.nextSpawn) {
    spawnCoin();
  }
}

function spawnCoin() {
  const attempts = 200;
  for (let i = 0; i < attempts; i++) {
    const cell = {
      x: Math.floor(Math.random() * gridSize),
      z: Math.floor(Math.random() * gridSize),
    };
    if (!isCellOccupied(cell)) {
      const position = cellToPosition(cell);
      if (!coin.mesh) {
        const geometry = new THREE.CylinderGeometry(tileSize * 0.35, tileSize * 0.35, tileSize * 0.2, 24);
        const material = new THREE.MeshStandardMaterial({
          color: 0xfff066,
          emissive: 0x665400,
          emissiveIntensity: 0.9,
          metalness: 0.45,
          roughness: 0.28,
        });
        coin.mesh = new THREE.Mesh(geometry, material);
        scene.add(coin.mesh);
      }
      coin.mesh.visible = true;
      coin.mesh.material.color.set(0xfff066);
      coin.mesh.material.emissive.set(0x665400);
      coin.mesh.material.emissiveIntensity = 0.9;
      const spawnPosition = clampPositionToGrid(position.clone());
      coin.mesh.position.copy(spawnPosition);
      coin.mesh.position.y = tileSize * 0.25;
      coin.mesh.rotation.set(0, 0, 0);
      coin.active = true;
      coin.cell = cell;
      return;
    }
  }

  // 빈 셀을 찾지 못하면 다음 기회에 재시도
  coin.nextSpawn = performance.now() + coin.interval;
}

function checkCoinCollision() {
  if (!coin.active || !coin.mesh) return;
  const head = snake.segments[0];
  const distance = head.position.distanceTo(coin.mesh.position);
  const threshold = tileSize * 0.65;
  if (distance <= threshold) {
    collectCoin();
  }
}

function collectCoin() {
  coin.active = false;
  if (coin.mesh) {
    coin.mesh.visible = false;
  }
  coin.nextSpawn = performance.now() + coin.interval;
  score += 1;
  updateScore();
  growSnake();
}

function growSnake() {
  const color = 0x1de9b6;
  const segment = createSegment(color, 0x0b5d4b, 0.45);
  const tailPosition = snake.segments[snake.segments.length - 1].position.clone();
  segment.position.copy(tailPosition);
  clampPositionToGrid(segment.position);
  scene.add(segment);
  snake.segments.push(segment);
}

function updateScore() {
  scoreEl.textContent = String(score);
}

function isCellOccupied(cell) {
  return snake.segments.some((segment) => {
    const segmentCell = positionToCell(segment.position);
    return segmentCell.x === cell.x && segmentCell.z === cell.z;
  });
}

function getRandomEmptyCell() {
  const attempts = 200;
  for (let i = 0; i < attempts; i++) {
    const cell = {
      x: Math.floor(Math.random() * gridSize),
      z: Math.floor(Math.random() * gridSize),
    };
    if (!isCellOccupied(cell)) {
      return cell;
    }
  }
  return { x: Math.floor(gridSize / 2), z: Math.floor(gridSize / 2) };
}

function cellToPosition(cell) {
  return new THREE.Vector3(
    -halfGrid + (cell.x + 0.5) * tileSize,
    snake.segmentHeight / 2,
    -halfGrid + (cell.z + 0.5) * tileSize
  );
}

function positionToCell(position) {
  const x = Math.floor((position.x + halfGrid) / tileSize);
  const z = Math.floor((position.z + halfGrid) / tileSize);
  return {
    x: THREE.MathUtils.clamp(x, 0, gridSize - 1),
    z: THREE.MathUtils.clamp(z, 0, gridSize - 1),
  };
}

function onWindowResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const aspect = width / height || 1;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
