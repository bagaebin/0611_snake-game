import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const container = document.getElementById('game-container');
const scoreEl = document.getElementById('score-value');
const statusEl = document.getElementById('input-status');
const permissionButton = document.getElementById('permission-button');
const introOverlay = document.getElementById('intro-overlay');
const startButton = document.getElementById('start-button');
const overlay = document.getElementById('game-over-overlay');
const restartButton = document.getElementById('restart-button');
const initialStatusMessage = statusEl.textContent;

const gridSize = 16;
const tileSize = 1;
const tileThickness = 0.3;
const raisedTileOffset = 0.08;
const snakeHoverOffset = tileThickness * 0.75;
const halfGrid = (gridSize * tileSize) / 2;
const frustumSize = gridSize * tileSize;

const bodyColors = [0x4fc1ff, 0x1f8dff];
const bodyEmissiveColors = [0x1a5e82, 0x0f4a82];
let nextBodyColorIndex = 0;

const snake = {
  segments: [],
  direction: new THREE.Vector3(1, 0, 0),
  targetDirection: new THREE.Vector3(1, 0, 0),
  speed: 4,
  segmentLength: tileSize,
  segmentHeight: tileSize * 0.55,
  pathPositions: [],
  pathDistances: [],
};

const coin = {
  mesh: null,
  light: null,
  active: false,
  cell: null,
  nextSpawn: performance.now() + 3000,
  interval: 5000,
};

const controlBasis = {
  right: new THREE.Vector3(1, 0, 0),
  down: new THREE.Vector3(0, 0, 1),
};
const upAxis = new THREE.Vector3(0, 1, 0);
const turnQuaternion = new THREE.Quaternion();

const inputState = {
  orientationSupported: false,
  orientationVector: new THREE.Vector3(),
  turnDirection: 0,
};

let scene, camera, renderer;
let lastFrameTime = performance.now();
let score = 0;
let isGameOver = false;
let isSessionActive = false;
let lastActiveStatusMessage = initialStatusMessage;

initScene();
initInput();
renderer.setAnimationLoop(animate);

startButton.addEventListener('click', () => {
  hideIntroOverlay();
  startGame();
});

restartButton.addEventListener('click', () => {
  startGame();
});

function setStatusMessage(message, { persist = true } = {}) {
  statusEl.textContent = message;
  if (persist) {
    lastActiveStatusMessage = message;
  }
}

function hideIntroOverlay() {
  if (!introOverlay) return;
  introOverlay.classList.add('hidden');
  introOverlay.setAttribute('aria-hidden', 'true');
}

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x01c756, 160, 520);

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
  updateControlBasis();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x01c756, 1);
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(80, 140, 60);
  scene.add(directional);

  createGrid();

  window.addEventListener('resize', onWindowResize);
}

function updateControlBasis() {
  if (!camera) return;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward).normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const down = new THREE.Vector3().crossVectors(right, forward).normalize().multiplyScalar(-1);

  controlBasis.right.copy(right).setY(0);
  if (controlBasis.right.lengthSq() === 0) {
    controlBasis.right.set(1, 0, 0);
  } else {
    controlBasis.right.normalize();
  }

  controlBasis.down.copy(down).setY(0);
  if (controlBasis.down.lengthSq() === 0) {
    controlBasis.down.set(0, 0, 1);
  } else {
    controlBasis.down.normalize();
  }
}

function createGrid() {
  const tileGeometry = new THREE.BoxGeometry(tileSize, tileThickness, tileSize);
  const tileMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x37ff7a, metalness: 0.08, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xaef4c6, metalness: 0.08, roughness: 0.68 }),
  ];

  const board = new THREE.Group();
  for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
      const materialIndex = (x + z) % 2;
      const tile = new THREE.Mesh(tileGeometry, tileMaterials[materialIndex]);
      tile.castShadow = false;
      tile.receiveShadow = true;
      tile.position.set(
        -halfGrid + (x + 0.5) * tileSize,
        -tileThickness / 2 + (materialIndex === 1 ? raisedTileOffset : 0),
        -halfGrid + (z + 0.5) * tileSize
      );
      board.add(tile);
    }
  }
  scene.add(board);
}

function getSnakeBaseY() {
  return snakeHoverOffset + snake.segmentHeight / 2;
}

function clampPositionToGrid(position) {
  const limit = halfGrid - tileSize * 0.5;
  position.x = THREE.MathUtils.clamp(position.x, -limit, limit);
  position.z = THREE.MathUtils.clamp(position.z, -limit, limit);
  return position;
}

function hideCoinLight() {
  if (coin.light) {
    coin.light.visible = false;
    coin.light.intensity = 0;
  }
}

function initInput() {
  if (typeof DeviceOrientationEvent !== 'undefined') {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      permissionButton.hidden = false;
      setStatusMessage('ALLOW SENSOR PERMISSION');
      permissionButton.addEventListener('click', async () => {
        try {
          const response = await DeviceOrientationEvent.requestPermission();
          if (response === 'granted') {
            attachOrientationListener();
            permissionButton.hidden = true;
            setStatusMessage('TILT CONTROL ENABLED');
          } else {
            setStatusMessage('SENSOR PERMISSION DENIED | KEY CONTROL');
            inputState.orientationSupported = false;
          }
        } catch (err) {
          console.error(err);
          setStatusMessage('SENSOR PERMISSION REQUEST FAILED | KEY CONTROL');
        }
      });
    } else {
      attachOrientationListener();
      setStatusMessage('TILT CONTROL ENABLED');
    }
  } else {
    setStatusMessage('SENSOR NOT SUPPORTED | KEY CONTROL');
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    let handled = false;
    if (event.key === 'ArrowLeft') {
      inputState.turnDirection = 1;
      handled = true;
    } else if (event.key === 'ArrowRight') {
      inputState.turnDirection = -1;
      handled = true;
    }

    if (handled) {
      event.preventDefault();
      setStatusMessage(
        inputState.orientationSupported
          ? 'TILT CONTROL'
          : 'KEY CONTROL'
      );
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowLeft' && inputState.turnDirection === 1) {
      inputState.turnDirection = 0;
      event.preventDefault();
    } else if (event.key === 'ArrowRight' && inputState.turnDirection === -1) {
      inputState.turnDirection = 0;
      event.preventDefault();
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

      const screenX = Math.sin(gammaRad);
      const screenY = Math.sin(betaRad);
      const magnitude = Math.hypot(screenX, screenY);
      const deadZone = 0.08;

      if (magnitude > deadZone) {
        const normalizedX = screenX / magnitude;
        const normalizedY = screenY / magnitude;
        const worldDirection = new THREE.Vector3();
        worldDirection.addScaledVector(controlBasis.right, normalizedX);
        worldDirection.addScaledVector(controlBasis.down, normalizedY);
        if (worldDirection.lengthSq() > 0) {
          worldDirection.normalize();
          inputState.orientationVector.copy(worldDirection);
        } else {
          inputState.orientationVector.setScalar(0);
        }
      } else {
        inputState.orientationVector.setScalar(0);
      }

      if (!inputState.orientationSupported) {
        setStatusMessage('기기를 기울이면 화면에서 더 낮아진 방향으로 이동합니다.');
      }
      inputState.orientationSupported = true;
    },
    true
  );
}

function startGame() {
  hideIntroOverlay();
  isSessionActive = true;
  isGameOver = false;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  clearSnake();
  score = 0;
  updateScore();
  setStatusMessage(lastActiveStatusMessage, { persist: false });
  inputState.turnDirection = 0;
  nextBodyColorIndex = 0;

  if (coin.mesh) {
    coin.mesh.visible = false;
  }
  hideCoinLight();
  coin.active = false;
  coin.cell = null;

  const startCell = getRandomEmptyCell();
  const startPosition = cellToPosition(startCell);
  snake.direction.set(1, 0, 0);
  snake.targetDirection.set(1, 0, 0);

  const head = createSegment(0xf23d9b, 0x5e1236, 0.65);
  head.position.copy(startPosition);
  head.position.y = getSnakeBaseY();
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

  if (isSessionActive && !isGameOver) {
    resolveInputDirection(delta);
    snake.direction.lerp(snake.targetDirection, 0.12);
    const head = snake.segments[0];
    if (head) {
      applyBoundarySlide(snake.direction, head.position);
    }
    if (snake.direction.lengthSq() > 0) {
      snake.direction.normalize();
    }

    moveSnake(delta);
    updateSegments();
    checkSelfCollision();
    updateCoin(delta, now);
  }

  renderer.render(scene, camera);
}

function resolveInputDirection(delta) {
  const head = snake.segments[0];
  const orientationVec = inputState.orientationVector;

  if (orientationVec.lengthSq() > 0) {
    snake.targetDirection.copy(orientationVec);
  } else {
    applyKeyboardTurn(delta);
  }

  if (head) {
    applyBoundarySlide(snake.targetDirection, head.position);
  }
}

function applyKeyboardTurn(delta) {
  if (inputState.turnDirection === 0) return;
  const turnSpeed = Math.PI; // radians per second
  const angle = inputState.turnDirection * turnSpeed * delta;
  if (angle === 0) return;

  turnQuaternion.setFromAxisAngle(upAxis, angle);
  snake.targetDirection.applyQuaternion(turnQuaternion);
  if (snake.targetDirection.lengthSq() === 0) {
    snake.targetDirection.set(1, 0, 0);
  } else {
    snake.targetDirection.normalize();
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
  let clampedAxis = false;

  if (position.x > limit) {
    position.x = limit;
    clampedAxis = true;
  } else if (position.x < -limit) {
    position.x = -limit;
    clampedAxis = true;
  }

  if (position.z > limit) {
    position.z = limit;
    clampedAxis = true;
  } else if (position.z < -limit) {
    position.z = -limit;
    clampedAxis = true;
  }

  clampPositionToGrid(position);
  if (clampedAxis) {
    applyBoundarySlide(snake.direction, position);
    applyBoundarySlide(snake.targetDirection, position);
  }
  position.y = previousPosition.y;
}

function applyBoundarySlide(vector, position) {
  if (!vector || typeof vector.lengthSq !== 'function' || vector.lengthSq() === 0 || !position) return;
  const limit = halfGrid - tileSize * 0.5;
  const epsilon = tileSize * 0.001;
  const normals = [];

  if (position.x >= limit - epsilon) normals.push(new THREE.Vector3(1, 0, 0));
  if (position.x <= -limit + epsilon) normals.push(new THREE.Vector3(-1, 0, 0));
  if (position.z >= limit - epsilon) normals.push(new THREE.Vector3(0, 0, 1));
  if (position.z <= -limit + epsilon) normals.push(new THREE.Vector3(0, 0, -1));

  if (normals.length === 0) return;

  let adjusted = false;
  const outwardTangent = new THREE.Vector3();

  normals.forEach((normal) => {
    const outwardComponent = vector.dot(normal);
    if (outwardComponent > 0) {
      vector.addScaledVector(normal, -outwardComponent);
      adjusted = true;
    }
    outwardTangent.add(new THREE.Vector3().crossVectors(upAxis, normal));
  });

  if (vector.lengthSq() < 1e-6) {
    if (outwardTangent.lengthSq() === 0) {
      normals.forEach((normal) => {
        outwardTangent.add(new THREE.Vector3().crossVectors(normal, upAxis));
      });
    }

    if (outwardTangent.lengthSq() > 0) {
      vector.copy(outwardTangent.normalize());
      adjusted = true;
    } else {
      vector.set(0, 0, 0);
    }
  }

  if (adjusted && vector.lengthSq() > 0) {
    vector.normalize();
  }
}

function trimPathBuffer(currentDistance) {
  const segmentCount = Math.max(1, snake.segments.length - 1);
  const bodyDistance = snake.segmentLength * segmentCount;
  const angularReserve = snake.segmentLength * 2;
  const maxDistance = bodyDistance + angularReserve;

  while (snake.pathDistances.length > 1 && snake.pathDistances[1] < currentDistance - maxDistance) {
    snake.pathDistances.shift();
    snake.pathPositions.shift();
  }
}

function updateSegments() {
  if (snake.segments.length <= 1) return;
  const totalDistance = snake.pathDistances[snake.pathDistances.length - 1] ?? 0;

  const sampleOffset = Math.max(0.1, snake.segmentLength * 0.35);

  for (let i = 1; i < snake.segments.length; i++) {
    const targetDistance = Math.max(0, totalDistance - snake.segmentLength * i);
    const position = getPositionAlongPath(targetDistance);
    snake.segments[i].position.copy(position);
    clampPositionToGrid(snake.segments[i].position);

    const aheadDistance = Math.min(totalDistance, targetDistance + sampleOffset);
    const behindDistance = Math.max(0, targetDistance - sampleOffset);
    const aheadPosition = getPositionAlongPath(aheadDistance);
    const behindPosition = getPositionAlongPath(behindDistance);
    const dir = aheadPosition.clone().sub(behindPosition);
    if (dir.lengthSq() > 1e-8) {
      dir.normalize();
      const angle = Math.atan2(dir.x, dir.z);
      snake.segments[i].rotation.set(0, angle, 0);
    }
  }
}

function checkSelfCollision() {
  if (snake.segments.length <= 2) return;
  const headCell = positionToCell(snake.segments[0].position);
  for (let i = 2; i < snake.segments.length; i++) {
    const segmentCell = positionToCell(snake.segments[i].position);
    if (segmentCell.x === headCell.x && segmentCell.z === headCell.z) {
      endGame();
      return;
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
  if (!isSessionActive || isGameOver) return;
  if (coin.active && coin.mesh) {
    coin.mesh.rotation.y += 1.5 * delta;
    const pulse = 0.85 + Math.sin(now * 0.004) * 0.35;
    const hover = Math.sin(now * 0.003) * tileSize * 0.05;
    coin.mesh.position.y = tileSize * 0.25 + hover;
    coin.mesh.material.emissiveIntensity = 0.75 + pulse * 0.4;
    if (coin.light) {
      coin.light.visible = true;
      coin.light.intensity = 2.6 + pulse * 1.6;
      coin.light.distance = tileSize * 7;
      coin.light.position.copy(coin.mesh.position);
      coin.light.position.y += tileSize * 1.4;
    }
    checkCoinCollision();
  } else if (now >= coin.nextSpawn) {
    spawnCoin();
  } else {
    hideCoinLight();
  }
}

function spawnCoin() {
  if (isGameOver) return;
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
          emissive: 0x7a5100,
          emissiveIntensity: 0.85,
          metalness: 0.45,
          roughness: 0.28,
        });
        coin.mesh = new THREE.Mesh(geometry, material);
        scene.add(coin.mesh);
      }
      if (!coin.light) {
        coin.light = new THREE.PointLight(0xfff066, 0, tileSize * 7, 2);
        coin.light.castShadow = false;
        scene.add(coin.light);
      }
      coin.mesh.visible = true;
      coin.mesh.material.color.set(0xfff066);
      coin.mesh.material.emissive.set(0x7a5100);
      coin.mesh.material.emissiveIntensity = 0.85;
      const spawnPosition = clampPositionToGrid(position.clone());
      coin.mesh.position.copy(spawnPosition);
      coin.mesh.position.y = tileSize * 0.25;
      coin.mesh.rotation.set(0, 0, 0);
      if (coin.light) {
        coin.light.visible = true;
        coin.light.intensity = 2.6;
        coin.light.position.copy(coin.mesh.position);
        coin.light.position.y += tileSize * 1.4;
      }
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
  if (isGameOver) return;
  coin.active = false;
  if (coin.mesh) {
    coin.mesh.visible = false;
  }
  hideCoinLight();
  coin.nextSpawn = performance.now() + coin.interval;
  score += 1;
  updateScore();
  growSnake();
}

function growSnake() {
  const colorIndex = nextBodyColorIndex % bodyColors.length;
  const color = bodyColors[colorIndex];
  const emissive = bodyEmissiveColors[colorIndex];
  const segment = createSegment(color, emissive, 0.42);
  nextBodyColorIndex++;
  const tailPosition = snake.segments[snake.segments.length - 1].position.clone();
  segment.position.copy(tailPosition);
  segment.position.y = getSnakeBaseY();
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
    getSnakeBaseY(),
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

function endGame() {
  if (isGameOver) return;
  isGameOver = true;
  isSessionActive = false;
  setStatusMessage('게임 오버! 다시 시작 버튼을 누르세요.', { persist: false });
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  coin.active = false;
  coin.cell = null;
  if (coin.mesh) {
    coin.mesh.visible = false;
  }
  hideCoinLight();
  restartButton.focus();
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
  updateControlBasis();
}
