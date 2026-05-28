
// const { WebSocketServer } = require("ws");
import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (socket) => {
    console.log("Alguien se conectó al servidor WebSocket");

    // socket.send("Estas conectado al servidor WebSocket");

    socket.on("message", (message) => {

        const data = JSON.parse(message);

        console.log("Mensaje recibido del cliente WebSocket:", data);

        // socket.send(JSON.stringify(data));

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                console.log("Enviando mensaje a cliente WebSocket:", data);
                client.send(JSON.stringify(data));
            }
        });


    });

    socket.on("close", () => {
        console.log("Alguien se desconectó del servidor WebSocket");
    });

});

console.log("Servidor WebSocket escuchando en el puerto 8080");
