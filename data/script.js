// =====================================================
// WEBSOCKET + ROLE MANAGEMENT
// =====================================================

const loc = window.location;
const WS_URL =
    (loc.protocol === "https:" ? "wss://" : "ws://") +
    loc.hostname + ":82";

// Seleccionar rol mediante la URL:
// ?role=conductor
// ?role=servo
// ?role=auxiliar

const validRoles = ["conductor", "servo", "auxiliar"];
const params = new URLSearchParams(window.location.search);

let role = params.get("role") || "conductor";

if (!validRoles.includes(role)) {
    role = "conductor";
}

// =====================================================
// CONTROL STATE
// =====================================================

let enabled = false;
let roleTimeout = null;
let ws = null;
let roleGranted = false;
let reconnectTimer = null;
let lastSend = 0;

const SEND_INTERVAL = 30;

// =====================================================
// ROLE-BASED INTERFACE
// =====================================================
function applyRoleInterface() {
    const roleConfig = {
        conductor: {
            show: ["#outerContainer", "#configBtn"],
            title: "Conductor"
        },
        servo: {
            show: ["#servoRow"],
            title: "Control de servo"
        },
        auxiliar: {
            show: ["#auxPanel"],
            title: "Motores auxiliares"
        }
    };

    const config = roleConfig[role] || roleConfig.conductor;

    // Ocultar los controles de todos los roles.
    ["#servoRow", "#auxPanel", "#outerContainer", "#configBtn"]
        .forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                element.hidden = true;
            });
        });

    // Mostrar solo los controles del rol seleccionado.
    config.show.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            element.hidden = false;
        });
    });

    // La configuración usa solamente la clase CSS .hidden.
    const configPanel = document.getElementById("configPanel");
    configPanel.hidden = false;
    configPanel.classList.add("hidden");

    document.title = `${config.title} | Mecanum Robot Control`;
}


function connectWebSocket() {
    if (ws && (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
    )) {
        return;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        roleGranted = false;
        updateConnectionStatus(true);

        console.log("[WS] Connected. Requesting role:", role);

        // El servidor debe responder ROLE_OK,rol o ROLE_BUSY.
        ws.send("ROLE," + role);
    };


    ws.onmessage = event => {
        const message = String(event.data).trim();
        console.log("[WS] Received:", message);
        
        if (message === "PONG") {
        return;
        }

        showAppAlert("Msg from ESP32", message);

        // Test motores 
        if (message === "TEST_STARTED") {
            document.getElementById("motorTestStatus").textContent =
                "Prueba en ejecución";
            return;
        }

        if (message === "TEST_BUSY") {
            document.getElementById("motorTestStatus").textContent =
                "La prueba ya está en ejecución";
            return;
        }

        if (message === "TEST_STOPPED") {
            document.getElementById("motorTestStatus").textContent =
                "Prueba detenida";
            return;
        }

        if (message === "TEST_DENIED") {
            showAppAlert("Sin autorización", "No tienes permiso para probar los motores.");
            return;
        }


        if (message === "ROLE_OK," + role) {
            clearTimeout(roleTimeout);
            roleGranted = true;

            lastDrivePacket = "";
            lastServoPacket = "";
            lastAuxPackets = ["", "", ""];

            updateEnableButton();
            setStatus(`Conectado · ${role}`, "connected");

            console.log("[WS] Role granted:", role);

            if (role === "conductor") {
                sendNow("DRIVE,0,0,0");
            } else if (role === "auxiliar") {
                sendNow("AUX,1,0");
                sendNow("AUX,2,0");
                sendNow("AUX,3,0");
            }

            return;
        }

        if (message === "ROLE_BUSY" || message === "ROLE_DENIED") {
            clearTimeout(roleTimeout);
            roleGranted = false;
            enabled = false;
            updateEnableButton();

            setStatus("Conectado · rol rechazado", "connecting");

            console.warn("[WS] Role unavailable:", message);

            showAppAlert(
                "Rol no disponible",
                message === "ROLE_BUSY"
                    ? `El rol "${role}" ya está ocupado por otro usuario.`
                    : `El ESP32 ha rechazado el rol "${role}".`
            );
            return;
        }

        if (message === "ROLE_REQUIRED") {
            clearTimeout(roleTimeout);
            roleGranted = false;
            enabled = false;
            updateEnableButton();

            setStatus("Conectado · falta autorización", "connecting");

            console.warn("[WS] Role assignment required");

            showAppAlert(
                "Autorización requerida",
                "El ESP32 solicita que se asigne el rol antes de aceptar comandos."
            );
            return;
        }

        // Conserva aquí cualquier otro procesamiento de mensajes
        // que tu implementación anterior pudiera necesitar.
    };


    ws.onclose = () => {
        roleGranted = false;
        enabled = false;

        updateConnectionStatus(false);
        updateEnableButton();

        console.log("[WS] Disconnected");

        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 1500);
    };

    ws.onerror = error => {
        console.error("[WS] Error:", error);
        updateConnectionStatus(false);
    };
}

// Envío inmediato: para asignación de rol y STOP.
function sendNow(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        lastSend = Date.now();
        return true;
    }

    return false;
}

// Envío limitado: para los controles periódicos.
function send(message) {
    const now = Date.now();
    const elapsed = now - lastSend;

    if (!ws || ws.readyState !== WebSocket.OPEN || !roleGranted) {
        return false;
    }

    if (elapsed < SEND_INTERVAL) {
        return false;
    }

    ws.send(message);
    lastSend = now;
    return true;
}

connectWebSocket();


let JoyLeft;
let JoyRight;


// Velocidad de cada motor auxiliar: -100 a 100.
let auxMotor1 = 0;
let auxMotor2 = 0;
let auxMotor3 = 0;

// =====================================================
// SERVO SLIDERS
// =====================================================

const servoLeftTrack =
    document.getElementById("servoLeftTrack");

const servoLeftKnob =
    document.getElementById("servoLeftKnob");

const servoRightTrack =
    document.getElementById("servoRightTrack");

const servoRightKnob =
    document.getElementById("servoRightKnob");

const servoLeftValue =
    document.getElementById("servoLeftValue");

const servoRightValue =
    document.getElementById("servoRightValue");

let servoLeftPos = 90;
let servoLeftTouchId = null;

let servoRightPos = 90;
let servoRightTouchId = null;

// Posición del servo: 0 a 100.
let defaultServoPosition = 50  ; 
let auxServoPosition = defaultServoPosition;



/* =======================
   CONTROLES MOTORES AUXILIARES
======================= */

// Actualiza la variable correspondiente al motor.
function setAuxMotor(motor, value) {
    if (motor === 1) auxMotor1 = value;
    if (motor === 2) auxMotor2 = value;
    if (motor === 3) auxMotor3 = value;
}

// CW = 100, CCW = -100.
// El motor se detiene cuando se suelta el botón.
document.querySelectorAll(".motorBtn").forEach(button => {
    const motor = Number(button.dataset.motor);
    const direction = Number(button.dataset.direction);

    button.addEventListener("pointerdown", event => {
        event.preventDefault();

        if (!enabled || !roleGranted || role !== "auxiliar") return;

        setAuxMotor(motor, direction);

        if (button.setPointerCapture) {
            button.setPointerCapture(event.pointerId);
        }
    });

    function releaseMotor() {
        const currentValue =
            motor === 1 ? auxMotor1 :
            motor === 2 ? auxMotor2 : auxMotor3;

        if (currentValue === direction) {
            setAuxMotor(motor, 0);
        }
    }

    button.addEventListener("pointerup", releaseMotor);
    button.addEventListener("pointercancel", releaseMotor);
    button.addEventListener("lostpointercapture", releaseMotor);
});

/* =======================
   CONTROL DEL SERVO
======================= */

const servoSlider = document.getElementById("servoSlider");
const servoValue = document.getElementById("servoValue");

servoSlider.addEventListener("input", () => {
    if (!enabled || !roleGranted || role !== "servo") {
        console.log("[UI] Servo ignorado: rol no autorizado o sistema deshabilitado");
        return;
    }

    auxServoPosition = Number(servoSlider.value);
    servoValue.textContent = `${auxServoPosition}%`;
});

// Inicializar el valor mostrado.
auxServoPosition = Number(servoSlider.value);
servoValue.textContent = `${auxServoPosition}%`;



  

// =====================================================
// CONTROL PACKET GENERATION
// =====================================================
    let invertForward = false;
    let invertStrafe  = false;
    let invertRotate  = false;


    function deadzone(value)
    {
        return Math.abs(value) < 10 ? 0 : value;
    }


function getControlData() {
    if (role !== "conductor") {
        return null;
    }

    if (!JoyLeft || !JoyRight || !enabled) {
        return "DRIVE,0,0,0";
    }

    let leftX  = Number(JoyLeft.GetX());
    let leftY  = Number(JoyLeft.GetY());
    let rightX = Number(JoyRight.GetX());
    let rightY = Number(JoyRight.GetY());

    // Priorizar el eje dominante.
    if (Math.abs(leftY) > Math.abs(leftX) * 2) leftX = 0;
    if (Math.abs(leftX) > Math.abs(leftY) * 2) leftY = 0;
    if (Math.abs(rightY) > Math.abs(rightX) * 2) rightX = 0;
    if (Math.abs(rightX) > Math.abs(rightY) * 2) rightY = 0;

    let forward = deadzone(leftY);
    let strafe  = deadzone(-leftX);
    let rotate  = deadzone(-rightX);

    if (invertForward) forward = -forward;
    if (invertStrafe)  strafe  = -strafe;
    if (invertRotate)  rotate  = -rotate;

    forward = Math.max(-100, Math.min(100, Math.round(forward)));
    strafe  = Math.max(-100, Math.min(100, Math.round(strafe)));
    rotate  = Math.max(-100, Math.min(100, Math.round(rotate)));

    return `DRIVE,${forward},${strafe},${rotate}`;
}

// =====================================================
// PERIODIC TRANSMISSION BY ROLE
// =====================================================

let lastDrivePacket = "";
let lastServoPacket = "";
let lastAuxPackets = ["", "", ""];

setInterval(() => {
    if (!roleGranted || !enabled) {
        return;
    }

    // ---------------------------------
    // CONDUCTOR
    // ---------------------------------
    if (role === "conductor") {
        const packet = getControlData();

        if (packet && packet !== lastDrivePacket) {
            if (send(packet)) {
                lastDrivePacket = packet;
                console.log("[TX][DRIVE]", packet);
            }
        }
    }

    // ---------------------------------
    // SERVO
    // ---------------------------------
    else if (role === "servo") {
        const position = Math.max(
            0,
            Math.min(100, Math.round(Number(auxServoPosition) || 0))
        );

        const packet = `SERVO,${position}`;

        if (packet !== lastServoPacket) {
            if (send(packet)) {
                lastServoPacket = packet;
                console.log("[TX][SERVO]", packet);
            }
        }
    }

    // ---------------------------------
    // AUXILIAR
    // ---------------------------------
    else if (role === "auxiliar") {
        const values = [auxMotor1, auxMotor2, auxMotor3];

        for (let i = 0; i < 3; i++) {
            const motor = i + 1;
            const speed = Math.max(
                -100,
                Math.min(100, Math.round(Number(values[i]) || 0))
            );

            const packet = `AUX,${motor},${speed}`;

            if (packet !== lastAuxPackets[i]) {
                if (send(packet)) {
                    lastAuxPackets[i] = packet;
                    console.log("[TX][AUX]", packet);
                }
            }
        }
    }

    send(packet);
}, 50);
 

function stopCurrentRole() {
    if (!roleGranted || !ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("[UI] STOP local: conexión o rol no disponible");
        return;
    }

    if (role === "conductor") {
        sendNow("DRIVE,0,0,0");
        lastDrivePacket = "DRIVE,0,0,0";
    }

    else if (role === "auxiliar") {
        setAuxMotor(1, 0);
        setAuxMotor(2, 0);
        setAuxMotor(3, 0);

        sendNow("AUX,1,0");
        sendNow("AUX,2,0");
        sendNow("AUX,3,0");

        lastAuxPackets = [
            "AUX,1,0",
            "AUX,2,0",
            "AUX,3,0"
        ];
    }

    // El servo mantiene su última posición.
}

// Motor Test

document.getElementById("startMotorTest").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showAppAlert("Sin conexión", "No hay conexión WebSocket con el ESP32.");
        return;
    }

    if (!roleGranted || role !== "conductor") {
        showAppAlert("Sin autorización", "Debes tener asignado el rol conductor.");
        return;
    }

    ws.send("TEST_MOTORS");
});

document.getElementById("stopMotorTest").addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send("STOP_MOTOR_TEST");
    }
});

/* =====================================================
   BUTTONS: ENABLE / STOP / CONFIG
   ===================================================== */


function updateEnableButton() {
    const button = document.getElementById("enableBtn");

    button.disabled = false;
    button.textContent = enabled ? "DISABLE" : "ENABLE";

    console.log("[ENABLE] UI actualizada:", {
        enabled,
        roleGranted,
        disabled: button.disabled,
        text: button.textContent
    });
}



document.getElementById("enableBtn").addEventListener("click", () => {
    showAppAlert(
        "Diagnóstico ENABLE",
        `Botón pulsado.\n\n` +
        `Rol: ${role}\n` +
        `Rol autorizado: ${roleGranted}\n` +
        `Estado enabled: ${enabled}\n` +
        `WebSocket: ${ws ? ws.readyState : "no inicializado"}`
    );

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showAppAlert(
            "Backend desconectado",
            "El WebSocket no está conectado al ESP32."
        );
        return;
    }

    if (!roleGranted) {
        showAppAlert(
            "Rol no autorizado",
            `Se recibió una pulsación, pero roleGranted es ${roleGranted}.`
        );
        return;
    }

    enabled = !enabled;
    updateEnableButton();

    showAppAlert(
        enabled ? "Control habilitado" : "Control deshabilitado",
        `Nuevo estado: ${enabled}\nRol: ${role}`
    );

    console.log("[ENABLE] Nuevo estado:", enabled);

    if (!enabled) {
        stopCurrentRole();
    }
});




document.getElementById("stopBtn").addEventListener("click", () => {
    console.warn("[UI] STOP solicitado");

    enabled = false;
    stopCurrentRole();

    updateEnableButton();
    console.log("[UI] STOP ejecutado");
});




/* =====================================================
   CONFIGURATION PANEL
   ===================================================== */

document.getElementById("configBtn").addEventListener("click", () => {
    const panel = document.getElementById("configPanel");

    if (!panel) return;

    panel.classList.toggle("hidden");
    console.log(
        "[UI] Configuración:",
        panel.classList.contains("hidden") ? "oculta" : "visible"
    );
});

/* =====================================================
   fullscreenBtn 
   ===================================================== */


const fullscreenToggle = document.getElementById("fullscreenToggle");

fullscreenToggle.addEventListener("change", async () => {
    try {
        if (fullscreenToggle.checked) {
            await document.documentElement.requestFullscreen();
        } else if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
    } catch (error) {
        fullscreenToggle.checked = !!document.fullscreenElement;

        showAppAlert(
            "Pantalla completa",
            `No se pudo cambiar el modo de pantalla completa.\n\n${error.name}: ${error.message}`
        );
    }
});

document.addEventListener("fullscreenchange", () => {
    fullscreenToggle.checked = !!document.fullscreenElement;
});



 // =====================================================
 // WEBSOCKET EVENTS
 // =====================================================
let heartbeatTimer = null;

ws.onopen = () => {
  console.log("[WS] Connected:", WS_URL);
  updateConnectionStatus(true);

  setStatus("Conectado · autorizando rol…", "connecting");

  // Solicitar autorización al ESP32
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(`ROLE,${role}`);
    console.log("[WS] Role requested:", role);
  }

  // Timeout para la autorización del rol
  clearTimeout(roleTimeout);
  roleTimeout = setTimeout(() => {
    if (!roleGranted) {
      console.warn("[WS] Role authorization timeout:", role);
      setStatus("Conectado · sin autorización", "connecting");

      showAppAlert(
        "Sin autorización",
        `El WebSocket está conectado, pero no se recibió ROLE_OK,${role} en 5 segundos.\n\nComprueba que el firmware del ESP32 admite este rol y responde con el formato esperado.`
      );
    }
  }, 5000);

  // Heartbeat periódico
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("PING");
    }
  }, 1000);

  console.log("[WS] Heartbeat iniciado (1000 ms)");
};


ws.onerror = (event) => {
  console.error("[WS] Connection error:", WS_URL, event);
  updateConnectionStatus(false);
  setStatus("Error de conexión", "disconnected");

  showAppAlert(
    "Error de conexión",
    `No se pudo establecer la comunicación con el ESP32.\n\nDirección: ${WS_URL}`
  );
};



ws.onclose = (event) => {
  console.warn("[WS] Connection closed:", event.code, event.reason);

  clearTimeout(roleTimeout);
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  roleGranted = false;
  enabled = false;

  updateEnableButton();
  updateConnectionStatus(false);
  setStatus("Desconectado", "disconnected");
};





function updateConnectionStatus(connected)
{
    const status = document.getElementById("status");
    const label = status.querySelector(".label");

    status.classList.remove("connected", "disconnected");

    if (connected) {
        status.classList.add("connected");
        label.textContent = "Connected";
    } else {
        status.classList.add("disconnected");
        label.textContent = "Disconnected";
    }

    if (roleGranted) {
        setStatus(`Conectado · ${role}`, "connected");
    }
}


// =====================================================
// INITIALIZATION
// =====================================================

window.addEventListener("load", () =>
{
    applyRoleInterface();

    document.getElementById("invertForward").onchange = (e) =>
    {
        invertForward = e.target.checked;
        console.log("invert F:", invertForward);
    };

    document.getElementById("invertStrafe").onchange = (e) =>
    {
        invertStrafe = e.target.checked;
        console.log("invert S:", invertStrafe);
    };

    document.getElementById("invertRotate").onchange = (e) =>
    {
        invertRotate = e.target.checked;
        console.log("invert R:", invertRotate);
    };



    // =========================
    // JOYSTICKS
    // =========================

    createJoysticks();
});


function createJoysticks() {
    if (role !== "conductor") {
        JoyLeft = null;
        JoyRight = null;
        return;
    }

    const left = document.getElementById("joyLeft");
    const right = document.getElementById("joyRight");

    left.innerHTML = "";
    right.innerHTML = "";

    JoyLeft = new JoyStick("joyLeft", {});

    JoyRight = new JoyStick("joyRight", {
        title: "joystick2"
    });
}

let resizeTimer;

window.addEventListener("resize", () =>
{
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() =>
    {
        JoyLeft.Resize();
        JoyRight.Resize();
    }, 200);
});


// Alerts

function showAppAlert(title, message) {
  document.getElementById("appAlertTitle").textContent = title;
  document.getElementById("appAlertMessage").textContent = message;
  document.getElementById("appAlert").hidden = false;
}

document.getElementById("appAlertClose").addEventListener("click", () => {
  document.getElementById("appAlert").hidden = true;
});

function setStatus(message, state = "disconnected") {
  const status = document.getElementById("status");
  const label = status.querySelector(".label");

  label.textContent = message;
  status.classList.remove("connected", "disconnected", "connecting");
  status.classList.add(state);
}

function refreshEnableButton() {
  const button = document.getElementById("enableBtn");
  button.textContent = enabled ? "DISABLE" : "ENABLE";
}


setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && roleGranted) {
        ws.send(`HEARTBEAT,${role}`);
    }
}, 250);