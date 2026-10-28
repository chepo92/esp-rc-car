var loc = window.location;
var WS_URL = (loc.protocol === "https:" ? "wss://" : "ws://") + window.location.hostname + ":82";
var ws = new WebSocket(WS_URL);

var lastText, lastSend, sendTimeout;
// limit sending to one message every 30 ms
// https://github.com/neonious/lowjs_esp32_examples/blob/master/neonious_one/cellphone_controlled_rc_car/www/index.html
function send(txt)
{
    var now = Date.now();

    if (lastSend === undefined || now - lastSend >= 30)
    {
        if (ws && ws.readyState === WebSocket.OPEN)
        {
            ws.send(txt);
            lastSend = Date.now();
            return;
        }
    }

    lastText = txt;

    if (!sendTimeout)
    {
        var ms = lastSend !== undefined ? 30 - (now - lastSend) : 30;

        if (ms < 0)
            ms = 0;

        sendTimeout = setTimeout(() =>
        {
            sendTimeout = null;
            send(lastText);
        }, ms);
    }
}

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

        if (!enabled) return;

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
    if (!enabled) {
        console.log("[UI] Servo ignorado: sistema deshabilitado");
        return;
    }

    auxServoPosition = Number(servoSlider.value);
    servoValue.textContent = `${auxServoPosition}%`;
});

// Inicializar el valor mostrado.
auxServoPosition = Number(servoSlider.value);
servoValue.textContent = `${auxServoPosition}%`;

/* =======================
   STOP GLOBAL
======================= */

// Añadir el evento sin reemplazar el manejador STOP existente.
document.getElementById("stopBtn").addEventListener("click", () => {
    setAuxMotor(1, 0);
    setAuxMotor(2, 0);
    setAuxMotor(3, 0);
});


  

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


function getControlData()
{
    // Si los joysticks no están disponibles, detener los motores.
    if (!JoyLeft || !JoyRight)
    {
        return "0,0,0,0,0,0,50";
    }

    let leftX  = Number(JoyLeft.GetX());
    let leftY  = Number(JoyLeft.GetY());
    let rightX = Number(JoyRight.GetX());
    let rightY = Number(JoyRight.GetY());

    // Priorizar el eje dominante para evitar movimientos diagonales.
    if (Math.abs(leftY) > Math.abs(leftX) * 2) leftX = 0;
    if (Math.abs(leftX) > Math.abs(leftY) * 2) leftY = 0;
    if (Math.abs(rightY) > Math.abs(rightX) * 2) rightX = 0;
    if (Math.abs(rightX) > Math.abs(rightY) * 2) rightY = 0;

    // Joystick izquierdo: avance y desplazamiento lateral.
    let forward = deadzone(leftY);
    let strafe  = deadzone(-leftX);

    // Joystick derecho: rotación.
    let rotate = deadzone(-rightX);

    // Los motores auxiliares se controlan desde la interfaz.
    let motor1 = Number(auxMotor1);
    let motor2 = Number(auxMotor2);
    let motor3 = Number(auxMotor3);

    // Posición del único servo: rango de 0 a 100.
    let servoPosition = Number(auxServoPosition);

    // Aplicar inversiones de los controles principales.
    if (invertForward) forward = -forward;
    if (invertStrafe)  strafe  = -strafe;
    if (invertRotate)  rotate  = -rotate;

    // Deshabilitar el movimiento detiene todos los motores.
    if (!enabled)
    {
        forward = 0;
        strafe  = 0;
        rotate  = 0;
        motor1  = 0;
        motor2  = 0;
        motor3  = 0;
    }



    // Limitar las velocidades de los motores al rango -100 a 100.
    forward = Math.max(-100, Math.min(100, Math.round(forward)));
    strafe  = Math.max(-100, Math.min(100, Math.round(strafe)));
    rotate  = Math.max(-100, Math.min(100, Math.round(rotate)));

    motor1 = Math.max(-100, Math.min(100, Math.round(motor1)));
    motor2 = Math.max(-100, Math.min(100, Math.round(motor2)));
    motor3 = Math.max(-100, Math.min(100, Math.round(motor3)));

    // Validar la posición del servo.
    if (!Number.isFinite(servoPosition)) servoPosition = 50;
    servoPosition = Math.max(0, Math.min(100, Math.round(servoPosition)));

    // Protocolo: avance, lateral, rotación, motor1, motor2, motor3, servo.
    return [
        forward,
        strafe,
        rotate,
        motor1,
        motor2,
        motor3,
        servoPosition
    ].join(",");
}


// =====================================================
// CONFIGURATION PANEL
// =====================================================

document
    .getElementById("configBtn")
    .onclick = () =>
    {
        document
            .getElementById("configPanel")
            .classList
            .toggle("hidden");
    };


// =====================================================
// PERIODIC TRANSMISSION
// =====================================================

let lastPacket = "";

setInterval(() => {
    const packet = getControlData();

    if (packet !== lastPacket) {
        console.log(packet);
        lastPacket = packet;
    }

    send(packet);
}, 50);


document.addEventListener(
    "touchmove",
    function(e)
    {
        if (
            e.target.closest("#joyLeft") ||
            e.target.closest("#joyRight")
        )
        {
            e.preventDefault();
        }
    },
    { passive: false }
);

let enabled = false;

// =====================================================
// BUTTONS
// =====================================================

function updateEnableButton()
{
    document.getElementById("enableBtn").textContent =
        enabled
        ? "DISABLE"
        : "ENABLE";
}

document
.getElementById("enableBtn")
.onclick = () =>
{
    enabled = !enabled;
    updateEnableButton();
    console.log(`[UI] ${enabled ? "ENABLE" : "DISABLE"}`);
};


document.getElementById("stopBtn").onclick = () => {
    enabled = false;

    // Detener los tres motores auxiliares
    auxMotor1 = 0;
    auxMotor2 = 0;
    auxMotor3 = 0;

    updateEnableButton();

    console.log("[UI] Stop button");

    send(getControlData());
};

// =====================================================
// WEBSOCKET EVENTS
// =====================================================


ws.onopen = () =>
{
    updateConnectionStatus(true);
    console.log("WebSocket conectado");
};

ws.onclose = () =>
{
    updateConnectionStatus(false);
    console.log("WebSocket cerrado");
};

ws.onerror = (e) =>
{
    updateConnectionStatus(false);
    console.log("WebSocket error", e);
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
}


// =====================================================
// INITIALIZATION
// =====================================================

window.addEventListener("load", () =>
{
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


function createJoysticks()
{
    const left = document.getElementById("joyLeft");
    const right = document.getElementById("joyRight");

    left.innerHTML = "";
    right.innerHTML = "";

    JoyLeft = new JoyStick("joyLeft", {});

    JoyRight = new JoyStick(
        "joyRight",
        {
            title: "joystick2"
        }
    );
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

