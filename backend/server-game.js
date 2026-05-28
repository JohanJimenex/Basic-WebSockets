import { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT) || 8081;
const ARENA_WIDTH = 720;
const ARENA_HEIGHT = 440;
const PLAYER_SIZE = 34;
const PLAYER_LIVES = 3;
const PROJECTILE_SIZE = 9;
const PROJECTILE_SPEED = 9;
const TICK_RATE = 1000 / 30;
const HIT_FLASH_MS = 260;
const ROUND_RESTART_MS = 2200;
const SHOOT_COOLDOWN_MS = 300;
const POWERUP_SIZE = 28;
const POWERUP_SPAWN_MS = 11000;
const MAX_POWERUPS = 4;
const POWERUP_DURATION_MS = 3000;
const HEAL_TICK_MS = 1000;
const SPEED_BOOST_MULTIPLIER = 1.45;
const POWERUP_TYPES = [
    { type: "heal", label: "Cura", shortLabel: "CU", color: "#16a34a" },
    { type: "tripleShot", label: "Triple Disparo", shortLabel: "3X", color: "#7c3aed" },
    { type: "speed", label: "Velocidad", shortLabel: "VE", color: "#f59e0b" },
    { type: "shield", label: "Escudo", shortLabel: "ES", color: "#0284c7" }
];

const wss = new WebSocketServer({ port: PORT });
const players = new Map();
const projectiles = new Map();
const powerups = new Map();
let isRoundEnding = false;

const send = (socket, data) => {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
};

const broadcast = (data, excludedSocket = null) => {
    for (const client of wss.clients) {
        if (client === excludedSocket) {
            continue;
        }

        send(client, data);
    }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value, fallback) => {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
};

const createPlayer = (id, name, color) => ({
    id,
    name: name || "Jugador",
    color: color || "#147d73",
    x: Math.floor(Math.random() * (ARENA_WIDTH - PLAYER_SIZE)),
    y: Math.floor(Math.random() * (ARENA_HEIGHT - PLAYER_SIZE - 20)) + 20,
    lives: PLAYER_LIVES,
    hitUntil: 0,
    lastShotAt: 0,
    activePowerup: null
});

const getPlayersSnapshot = () => Array.from(players.values());
const getProjectilesSnapshot = () => Array.from(projectiles.values());
const getPowerupsSnapshot = () => Array.from(powerups.values());

const getGameState = () => ({
    type: "state",
    players: getPlayersSnapshot(),
    projectiles: getProjectilesSnapshot(),
    powerups: getPowerupsSnapshot()
});

const resetRound = () => {
    projectiles.clear();
    powerups.clear();

    for (const player of players.values()) {
        player.lives = PLAYER_LIVES;
        player.hitUntil = 0;
        player.activePowerup = null;
        player.x = Math.floor(Math.random() * (ARENA_WIDTH - PLAYER_SIZE));
        player.y = Math.floor(Math.random() * (ARENA_HEIGHT - PLAYER_SIZE - 20)) + 20;
    }

    isRoundEnding = false;
    broadcast(getGameState());
};

const rectanglesOverlap = (a, b) => (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
);

const broadcastRoundResult = () => {
    const alivePlayers = getPlayersSnapshot().filter((player) => player.lives > 0);
    const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;

    isRoundEnding = true;
    projectiles.clear();
    broadcast({
        type: "roundResult",
        winnerId: winner?.id || null,
        winnerName: winner?.name || null,
        players: getPlayersSnapshot()
    });

    setTimeout(resetRound, ROUND_RESTART_MS);
};

const maybeFinishRound = () => {
    if (isRoundEnding || players.size < 2) {
        return;
    }

    const alivePlayers = getPlayersSnapshot().filter((player) => player.lives > 0);

    if (alivePlayers.length <= 1) {
        broadcastRoundResult();
    }
};

const createPowerup = () => {
    const definition = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];

    return {
        id: randomUUID(),
        type: definition.type,
        label: definition.label,
        shortLabel: definition.shortLabel,
        color: definition.color,
        x: Math.floor(Math.random() * (ARENA_WIDTH - POWERUP_SIZE)),
        y: Math.floor(Math.random() * (ARENA_HEIGHT - POWERUP_SIZE - 20)) + 20
    };
};

const spawnPowerup = () => {
    if (isRoundEnding || players.size === 0 || powerups.size >= MAX_POWERUPS) {
        return;
    }

    const powerup = createPowerup();

    powerups.set(powerup.id, powerup);
    broadcast({ type: "powerupSpawned", powerup });
};

const applyPowerup = (player, powerup) => {
    const now = Date.now();

    player.activePowerup = {
        type: powerup.type,
        label: powerup.label,
        shortLabel: powerup.shortLabel,
        color: powerup.color,
        expiresAt: now + POWERUP_DURATION_MS
    };

    if (powerup.type === "heal") {
        player.lives = Math.min(PLAYER_LIVES, player.lives + 1);
        player.activePowerup.nextHealAt = now + HEAL_TICK_MS;
    }
};

const getActivePowerup = (player, type) => {
    if (!player.activePowerup || player.activePowerup.expiresAt <= Date.now()) {
        player.activePowerup = null;
        return null;
    }

    return player.activePowerup.type === type ? player.activePowerup : null;
};

const updateActivePowerups = () => {
    const now = Date.now();

    for (const player of players.values()) {
        if (!player.activePowerup) {
            continue;
        }

        if (player.activePowerup.type === "heal" && player.activePowerup.nextHealAt <= now) {
            player.lives = Math.min(PLAYER_LIVES, player.lives + 1);
            player.activePowerup.nextHealAt += HEAL_TICK_MS;
        }

        if (player.activePowerup.expiresAt <= now) {
            player.activePowerup = null;
        }
    }
};

const updatePowerupCollisions = () => {
    for (const player of players.values()) {
        if (player.lives <= 0) {
            continue;
        }

        for (const powerup of powerups.values()) {
            const didCollect = rectanglesOverlap(
                { x: player.x, y: player.y, width: PLAYER_SIZE, height: PLAYER_SIZE },
                { x: powerup.x, y: powerup.y, width: POWERUP_SIZE, height: POWERUP_SIZE }
            );

            if (!didCollect) {
                continue;
            }

            applyPowerup(player, powerup);
            powerups.delete(powerup.id);
            broadcast({ type: "powerupCollected", player, powerupId: powerup.id, powerupType: powerup.type });
            break;
        }
    }
};

const createProjectile = (player, dx, dy) => ({
    id: randomUUID(),
    ownerId: player.id,
    color: player.color,
    x: player.x + PLAYER_SIZE / 2 - PROJECTILE_SIZE / 2 + dx * PLAYER_SIZE / 2,
    y: player.y + PLAYER_SIZE / 2 - PROJECTILE_SIZE / 2 + dy * PLAYER_SIZE / 2,
    vx: dx * PROJECTILE_SPEED,
    vy: dy * PROJECTILE_SPEED
});

const updateProjectiles = () => {
    if (isRoundEnding) {
        return;
    }

    updateActivePowerups();
    updatePowerupCollisions();

    for (const projectile of projectiles.values()) {
        projectile.x += projectile.vx;
        projectile.y += projectile.vy;

        const isOutsideArena = (
            projectile.x < -PROJECTILE_SIZE ||
            projectile.x > ARENA_WIDTH + PROJECTILE_SIZE ||
            projectile.y < -PROJECTILE_SIZE ||
            projectile.y > ARENA_HEIGHT + PROJECTILE_SIZE
        );

        if (isOutsideArena) {
            projectiles.delete(projectile.id);
            continue;
        }

        for (const player of players.values()) {
            if (player.id === projectile.ownerId || player.lives <= 0) {
                continue;
            }

            const didHit = rectanglesOverlap(
                { x: projectile.x, y: projectile.y, width: PROJECTILE_SIZE, height: PROJECTILE_SIZE },
                { x: player.x, y: player.y, width: PLAYER_SIZE, height: PLAYER_SIZE }
            );

            if (!didHit) {
                continue;
            }

            if (getActivePowerup(player, "shield")) {
                player.activePowerup = null;
            } else {
                player.lives = Math.max(0, player.lives - 1);
                player.hitUntil = Date.now() + HIT_FLASH_MS;
            }

            projectiles.delete(projectile.id);
            maybeFinishRound();
            break;
        }
    }

    broadcast(getGameState());
};

wss.on("connection", (socket) => {
    const playerId = randomUUID();

    console.log(`Jugador conectado: ${playerId}`);

    socket.on("message", (message) => {
        let data;

        try {
            data = JSON.parse(message);
        } catch {
            send(socket, { type: "error", message: "Mensaje inválido" });
            return;
        }

        if (data.type === "join") {
            const player = createPlayer(playerId, data.name, data.color);

            players.set(playerId, player);
            send(socket, {
                type: "welcome",
                id: playerId,
                players: getPlayersSnapshot(),
                projectiles: getProjectilesSnapshot(),
                powerups: getPowerupsSnapshot()
            });
            broadcast({ type: "playerJoined", player });
        }

        if (data.type === "move") {
            const player = players.get(playerId);

            if (!player || player.lives <= 0 || isRoundEnding) {
                return;
            }

            const speedMultiplier = getActivePowerup(player, "speed") ? SPEED_BOOST_MULTIPLIER : 1;
            const maxMoveDistance = 18 * speedMultiplier;
            const requestedX = clamp(toFiniteNumber(data.x, player.x), 0, ARENA_WIDTH - PLAYER_SIZE);
            const requestedY = clamp(toFiniteNumber(data.y, player.y), 20, ARENA_HEIGHT - PLAYER_SIZE);

            player.x = clamp(requestedX, player.x - maxMoveDistance, player.x + maxMoveDistance);
            player.y = clamp(requestedY, player.y - maxMoveDistance, player.y + maxMoveDistance);

            broadcast({ type: "playerMoved", player }, socket);
        }

        if (data.type === "shoot") {
            const player = players.get(playerId);
            const now = Date.now();

            if (!player || player.lives <= 0 || isRoundEnding || now - player.lastShotAt < SHOOT_COOLDOWN_MS) {
                return;
            }

            const rawDx = toFiniteNumber(data.dx, 1);
            const rawDy = toFiniteNumber(data.dy, 0);
            const distance = Math.hypot(rawDx, rawDy) || 1;
            const dx = rawDx / distance;
            const dy = rawDy / distance;

            player.lastShotAt = now;

            const spreadAngles = getActivePowerup(player, "tripleShot") ? [-0.22, 0, 0.22] : [0];
            const createdProjectiles = spreadAngles.map((angle) => {
                const spreadDx = dx * Math.cos(angle) - dy * Math.sin(angle);
                const spreadDy = dx * Math.sin(angle) + dy * Math.cos(angle);
                const projectile = createProjectile(player, spreadDx, spreadDy);

                projectiles.set(projectile.id, projectile);
                return projectile;
            });

            broadcast({ type: "projectilesCreated", projectiles: createdProjectiles });
        }

        if (data.type === "rename") {
            const player = players.get(playerId);

            if (!player) {
                return;
            }

            player.name = String(data.name || "Jugador").trim().slice(0, 16) || "Jugador";
            broadcast({ type: "playerRenamed", player });
        }
    });

    socket.on("close", () => {
        players.delete(playerId);
        for (const projectile of projectiles.values()) {
            if (projectile.ownerId === playerId) {
                projectiles.delete(projectile.id);
            }
        }
        broadcast({ type: "playerLeft", id: playerId });
        maybeFinishRound();
        console.log(`Jugador desconectado: ${playerId}`);
    });
});

wss.on("listening", () => {
    console.log(`Servidor del minijuego escuchando en ws://localhost:${PORT}`);
});

wss.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`El puerto ${PORT} ya está en uso. Cierra el otro servidor o usa PORT=otro_puerto.`);
        process.exit(1);
    }

    throw error;
});

setInterval(updateProjectiles, TICK_RATE);
setInterval(spawnPowerup, POWERUP_SPAWN_MS);
