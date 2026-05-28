const getServerUrl = () => {
    const GAME_SERVER_PORT = 8081;
    const urlParams = new URLSearchParams(window.location.search);
    const customServerUrl = urlParams.get("server");

    if (customServerUrl) {
        return customServerUrl;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname || "localhost";
    const isDevTunnel = host.endsWith(".devtunnels.ms");
    const gameServerHost = isDevTunnel
        ? host.replace(/-\d+(\..*\.devtunnels\.ms)$/, `-${GAME_SERVER_PORT}$1`)
        : host;

    return isDevTunnel
        ? `${protocol}://${gameServerHost}`
        : `${protocol}://${gameServerHost}:${GAME_SERVER_PORT}`;
};

const SERVER_URL = getServerUrl();
const PLAYER_SIZE = 34;
const MOVE_SPEED = 3.6;
const PROJECTILE_SIZE = 9;
const POWERUP_SIZE = 28;
const SPEED_BOOST_MULTIPLIER = 1.45;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const connectionStatus = document.getElementById("connectionStatus");
const connectionMessage = document.getElementById("connectionMessage");
const playerNameInput = document.getElementById("playerNameInput");
const playersCount = document.getElementById("playersCount");

const players = new Map();
const projectiles = new Map();
const powerups = new Map();
const pressedKeys = new Set();

let socket;
let myId = null;
let localPlayer = null;
let animationFrameId = null;
let lastSentPosition = { x: null, y: null };
let roundMessageTimeoutId = null;

const playerName = localStorage.getItem("minigamePlayerName") || `Jugador ${Math.floor(Math.random() * 900 + 100)}`;
playerNameInput.value = playerName;

const setStatus = (text, className) => {
    connectionStatus.textContent = text;
    connectionStatus.className = `status ${className}`;
};

const showSystemMessage = (text, className = "system-message") => {
    connectionMessage.textContent = text;
    connectionMessage.className = className;
    connectionMessage.hidden = false;
};

const hideSystemMessage = () => {
    connectionMessage.hidden = true;
};

const sendToServer = (data) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    socket.send(JSON.stringify(data));
};

const getPlayerColor = (id) => {
    let hash = 0;

    for (const character of id) {
        hash = character.charCodeAt(0) + ((hash << 5) - hash);
    }

    return `hsl(${Math.abs(hash) % 360} 68% 45%)`;
};

const getRandomToken = () => `${Date.now()}-${Math.random()}`;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const isTypingInTextField = (event) => {
    const element = event.target;

    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;
};

const drawGrid = () => {
    ctx.strokeStyle = "#d9e4ea";
    ctx.lineWidth = 1;

    for (let x = 0; x <= canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let y = 0; y <= canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
};

const drawPlayer = (player) => {
    const isMe = player.id === myId;
    const now = Date.now();
    const isHit = player.hitUntil && player.hitUntil > Date.now();
    const isOut = player.lives <= 0;
    const activePowerup = player.activePowerup && player.activePowerup.expiresAt > now ? player.activePowerup : null;
    const hasShield = activePowerup?.type === "shield";

    ctx.globalAlpha = isOut ? 0.38 : 1;
    ctx.fillStyle = isHit ? "#dc2626" : player.color;
    ctx.strokeStyle = hasShield ? "#0284c7" : isMe ? "#111827" : "#ffffff";
    ctx.lineWidth = isMe ? 4 : 3;

    ctx.beginPath();
    ctx.roundRect(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#000000";
    ctx.font = "700 13px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(player.name, player.x + PLAYER_SIZE / 2, player.y - 7);

    ctx.font = "800 12px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`V ${player.lives}`, player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2);

    if (!isOut && activePowerup) {
        ctx.fillStyle = "#152033";
        ctx.font = "800 10px Arial, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(activePowerup.shortLabel, player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE + 5);
    }

    ctx.globalAlpha = 1;
};

const drawProjectile = (projectile) => {
    ctx.fillStyle = projectile.color || "#111827";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(projectile.x + PROJECTILE_SIZE / 2, projectile.y + PROJECTILE_SIZE / 2, PROJECTILE_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
};

const drawPowerup = (powerup) => {
    ctx.fillStyle = powerup.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(powerup.x, powerup.y, POWERUP_SIZE, POWERUP_SIZE, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 15px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(powerup.shortLabel, powerup.x + POWERUP_SIZE / 2, powerup.y + POWERUP_SIZE / 2);

    ctx.fillStyle = "#152033";
    ctx.font = "800 10px Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(powerup.label, powerup.x + POWERUP_SIZE / 2, powerup.y + POWERUP_SIZE + 4);
};

const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fbfd";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    for (const powerup of powerups.values()) {
        drawPowerup(powerup);
    }

    for (const projectile of projectiles.values()) {
        drawProjectile(projectile);
    }

    for (const player of players.values()) {
        drawPlayer(player);
    }
};

const updatePlayersCount = () => {
    playersCount.textContent = players.size;
};

const setPlayersFromServer = (serverPlayers, options = {}) => {
    const { preserveLocalPosition = false } = options;
    const currentLocalPlayer = players.get(myId);

    players.clear();

    for (const player of serverPlayers) {
        if (preserveLocalPosition && currentLocalPlayer && player.id === myId) {
            players.set(player.id, {
                ...player,
                x: currentLocalPlayer.x,
                y: currentLocalPlayer.y
            });
        } else {
            players.set(player.id, player);
        }
    }

    localPlayer = players.get(myId) || null;
    updatePlayersCount();
};

const setProjectilesFromServer = (serverProjectiles = []) => {
    projectiles.clear();

    for (const projectile of serverProjectiles) {
        projectiles.set(projectile.id, projectile);
    }
};

const setPowerupsFromServer = (serverPowerups = []) => {
    powerups.clear();

    for (const powerup of serverPowerups) {
        powerups.set(powerup.id, powerup);
    }
};

const handleServerMessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "welcome") {
        myId = data.id;
        setPlayersFromServer(data.players);
        setProjectilesFromServer(data.projectiles);
        setPowerupsFromServer(data.powerups);
        hideSystemMessage();
        setStatus("Conectado", "status-open");
    }

    if (data.type === "state") {
        setPlayersFromServer(data.players, { preserveLocalPosition: true });
        setProjectilesFromServer(data.projectiles);
        setPowerupsFromServer(data.powerups);
    }

    if (data.type === "playerJoined" || data.type === "playerMoved" || data.type === "playerRenamed") {
        players.set(data.player.id, data.player);
        localPlayer = players.get(myId) || null;
        updatePlayersCount();
    }

    if (data.type === "playerLeft") {
        players.delete(data.id);
        updatePlayersCount();
    }

    if (data.type === "projectileCreated") {
        projectiles.set(data.projectile.id, data.projectile);
    }

    if (data.type === "projectilesCreated") {
        for (const projectile of data.projectiles) {
            projectiles.set(projectile.id, projectile);
        }
    }

    if (data.type === "powerupSpawned") {
        powerups.set(data.powerup.id, data.powerup);
    }

    if (data.type === "powerupCollected") {
        powerups.delete(data.powerupId);
        players.set(data.player.id, data.player);
        localPlayer = players.get(myId) || null;
    }

    if (data.type === "roundResult") {
        setPlayersFromServer(data.players);
        projectiles.clear();
        powerups.clear();

        if (data.winnerId === myId) {
            showSystemMessage("Has ganado. La ronda se reinicia en un momento.", "system-message system-message-win");
        } else {
            showSystemMessage("Has perdido. La ronda se reinicia en un momento.", "system-message system-message-error");
        }

        clearTimeout(roundMessageTimeoutId);
        roundMessageTimeoutId = setTimeout(hideSystemMessage, 2400);
    }

    draw();
};

const moveLocalPlayer = () => {
    if (!localPlayer || localPlayer.lives <= 0) {
        return;
    }

    let dx = 0;
    let dy = 0;
    const activePowerup = localPlayer.activePowerup && localPlayer.activePowerup.expiresAt > Date.now() ? localPlayer.activePowerup : null;
    const speedMultiplier = activePowerup?.type === "speed" ? SPEED_BOOST_MULTIPLIER : 1;
    const currentSpeed = MOVE_SPEED * speedMultiplier;

    if (pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA")) dx -= currentSpeed;
    if (pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD")) dx += currentSpeed;
    if (pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW")) dy -= currentSpeed;
    if (pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS")) dy += currentSpeed;

    if (dx === 0 && dy === 0) {
        return;
    }

    localPlayer.x = clamp(localPlayer.x + dx, 0, canvas.width - PLAYER_SIZE);
    localPlayer.y = clamp(localPlayer.y + dy, 20, canvas.height - PLAYER_SIZE);

    players.set(myId, localPlayer);
    draw();

    if (localPlayer.x !== lastSentPosition.x || localPlayer.y !== lastSentPosition.y) {
        sendToServer({
            type: "move",
            x: localPlayer.x,
            y: localPlayer.y
        });
        lastSentPosition = { x: localPlayer.x, y: localPlayer.y };
    }
};

const getCanvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
};

const shootAt = (target) => {
    if (!localPlayer || localPlayer.lives <= 0) {
        return;
    }

    const playerCenterX = localPlayer.x + PLAYER_SIZE / 2;
    const playerCenterY = localPlayer.y + PLAYER_SIZE / 2;

    sendToServer({
        type: "shoot",
        dx: target.x - playerCenterX,
        dy: target.y - playerCenterY
    });
};

const gameLoop = () => {
    moveLocalPlayer();
    animationFrameId = requestAnimationFrame(gameLoop);
};

const connect = () => {
    socket = new WebSocket(SERVER_URL);
    setStatus("Conectando", "status-connecting");

    socket.addEventListener("open", () => {
        sendToServer({
            type: "join",
            name: playerNameInput.value.trim() || "Jugador",
            color: getPlayerColor(getRandomToken())
        });
    });

    socket.addEventListener("message", handleServerMessage);

    socket.addEventListener("close", () => {
        setStatus("Sin conexión", "status-error");
        showSystemMessage("No se pudo conectar al servidor del juego. Ejecuta el servidor y recarga la página.");
    });

    socket.addEventListener("error", () => {
        setStatus("Error", "status-error");
        showSystemMessage("No se pudo conectar al servidor del juego. Ejecuta el servidor y recarga la página.");
    });
};

document.addEventListener("keydown", (event) => {
    const movementKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"];

    if (isTypingInTextField(event)) {
        return;
    }

    if (movementKeys.includes(event.code)) {
        event.preventDefault();
    }

    if (movementKeys.includes(event.code)) {
        pressedKeys.add(event.code);
    }
});

document.addEventListener("keyup", (event) => {
    if (isTypingInTextField(event)) {
        return;
    }

    pressedKeys.delete(event.code);
});

playerNameInput.addEventListener("focus", () => {
    pressedKeys.clear();
});

canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    shootAt(getCanvasPoint(event));
});

playerNameInput.addEventListener("change", () => {
    const name = playerNameInput.value.trim() || "Jugador";

    playerNameInput.value = name;
    localStorage.setItem("minigamePlayerName", name);
    sendToServer({ type: "rename", name });
});

draw();
connect();
gameLoop();

window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(animationFrameId);
});
