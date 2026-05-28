const webSocket = new WebSocket("ws://localhost:8080");
const chatForm = document.getElementById("chatForm");
const usernameInput = document.getElementById("usernameInput");
const messageInput = document.getElementById("messageInput");
const messagesDiv = document.getElementById("messages");
const connectionStatus = document.getElementById("connectionStatus");

const setStatus = (text, className) => {
    connectionStatus.textContent = text;
    connectionStatus.className = `status ${className}`;
};

const removeEmptyState = () => {
    const emptyState = messagesDiv.querySelector(".empty-state");

    if (emptyState) {
        emptyState.remove();
    }
};

webSocket.onopen = () => {
    console.log("Conexion WebSocket abierta");
    setStatus("Conectado", "status-open");
};

webSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    console.log("Mensaje recibido del servidor WebSocket:", data);

    if (data.usuario && data.mensaje) {
        removeEmptyState();

        const newMessage = document.createElement("p");
        const user = document.createElement("span");
        const text = document.createElement("span");

        newMessage.className = "message";
        user.className = "message-user";
        text.className = "message-text";
        user.textContent = data.usuario;
        text.textContent = data.mensaje;

        if (data.usuario === usernameInput.value.trim()) {
            newMessage.classList.add("own");
        }

        newMessage.append(user, text);
        messagesDiv.appendChild(newMessage);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
};

webSocket.onclose = () => {
    setStatus("Desconectado", "status-closed");
};

webSocket.onerror = () => {
    setStatus("Error", "status-error");
};

const sendMessage = () => {
    const username = usernameInput.value.trim();
    const message = messageInput.value.trim();

    if (!username || !message) {
        return;
    }

    webSocket.send(JSON.stringify({ usuario: username, mensaje: message }));
    messageInput.value = "";
    messageInput.focus();
};

chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
});
