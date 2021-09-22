
const view = document.getElementById('stream');
const WS_URL = "ws://" + window.location.host + ":82";
const ws = new WebSocket(WS_URL);

ws.onmessage = message => {
    if (message.data instanceof Blob) {
        var urlObject = URL.createObjectURL(message.data);
        view.src = urlObject;
    }
};

var lastText, lastSend, sendTimeout;
// limit sending to one message every 30 ms
// https://github.com/neonious/lowjs_esp32_examples/blob/master/neonious_one/cellphone_controlled_rc_car/www/index.html
function send(txt) {
    var now = new Date().getTime();
    if (lastSend === undefined || now - lastSend >= 30) {
        try {
            ws.send(txt);
            lastSend = new Date().getTime();
            return;
        } catch (e) {
            console.log(e);
        }
    }
    lastText = txt;
    if (!sendTimeout) {
        var ms = lastSend !== undefined ? 30 - (now - lastSend) : 30;
        if (ms < 0)
            ms = 0;
        sendTimeout = setTimeout(() => {
            sendTimeout = null;
            send(lastText);
        }, ms);
    }
}



// Create JoyStick object into the DIV 'joyDiv'
var joy = new JoyStick('joyDiv');
var inputPosX = document.getElementById("posizioneX");
var inputPosY = document.getElementById("posizioneY");
var direzione = document.getElementById("direzione");
var fuerzaI = document.getElementById("fuerzaI");
var fuerzaD = document.getElementById("fuerzaD");
var x = document.getElementById("X");
var y = document.getElementById("Y");

//Steering control program, based on :
// Differential Steering Joystick Algorithm
//   by Calvin Hass
//   https://www.impulseadventure.com/elec/

function getfuerza(nJoyX, nJoyY) {
    var nMotMixL;
    var nMotMixR;
    var fPivYLimit = 32.0; //The threshold at which the pivot action starts
    //                This threshold is measured in units on the Y-axis
    //                away from the X-axis (Y=0). A greater value will assign
    //                more of the joystick's range to pivot actions.
    //                Allowable range: (0..+127)

    // TEMP VARIABLES
    var nMotPremixL;    // Motor (left)  premixed output        (-128..+127)
    var nMotPremixR;    // Motor (right) premixed output        (-128..+127)
    var nPivSpeed;      // Pivot Speed                          (-128..+127)
    var fPivScale;      // Balance scale b/w drive and pivot    (   0..1   )

    // Calculate Drive Turn output due to Joystick X input
    if (nJoyY >= 0) {
        // Forward
        nMotPremixL = (nJoyX >= 0 ? 100.0 : 100.0 + parseFloat(nJoyX));
        nMotPremixR = (nJoyX >= 0 ? 100.0 - nJoyX : 100.0);
    } else {
        // Reverse
        nMotPremixL = (nJoyX >= 0 ? 100.0 - nJoyX : 100.0);
        nMotPremixR = (nJoyX >= 0 ? 100.0 : 100.0 + parseFloat(nJoyX));
    }

    // Scale Drive output due to Joystick Y input (throttle)
    nMotPremixL = nMotPremixL * nJoyY / 100.0;
    nMotPremixR = nMotPremixR * nJoyY / 100.0;

    // Now calculate pivot amount
    // - Strength of pivot (nPivSpeed) based on Joystick X input
    // - Blending of pivot vs drive (fPivScale) based on Joystick Y input
    nPivSpeed = nJoyX;
    fPivScale = (Math.abs(nJoyY) > fPivYLimit) ? 0.0 : (1.0 - Math.abs(nJoyY) / fPivYLimit);

    // Calculate final mix of Drive and Pivot
    nMotMixL = (1.0 - fPivScale) * nMotPremixL + fPivScale * (nPivSpeed);
    nMotMixR = (1.0 - fPivScale) * nMotPremixR + fPivScale * (-nPivSpeed);

    return Math.round(nMotMixL * 2.55) + "," + Math.round(nMotMixR * 2.55);   // The function returns the product of p1 and p2
}

setInterval(function () { send(getfuerza(joy.GetX(), joy.GetY())); }, 300);

var JoyStick = function (t, e) { var i = void 0 === (e = e || {}).title ? "joystick" : e.title, n = void 0 === e.width ? 0 : e.width, o = void 0 === e.height ? 0 : e.height, h = void 0 === e.internalFillColor ? "#00AA00" : e.internalFillColor, r = void 0 === e.internalLineWidth ? 2 : e.internalLineWidth, d = void 0 === e.internalStrokeColor ? "#003300" : e.internalStrokeColor, a = void 0 === e.externalLineWidth ? 2 : e.externalLineWidth, l = void 0 === e.externalStrokeColor ? "#008000" : e.externalStrokeColor, c = document.getElementById(t), u = document.createElement("canvas"); u.id = i, 0 == n && (n = c.clientWidth), 0 == o && (o = c.clientHeight), u.width = n, u.height = o, c.appendChild(u); var s = u.getContext("2d"), f = 0, v = 2 * Math.PI, g = (u.width - 110) / 2, w = g + 5, C = g + 30, m = u.width / 2, p = u.height / 2, L = u.width / 10, E = -1 * L, S = u.height / 10, k = -1 * S, W = m, G = p; function x() { s.beginPath(), s.arc(m, p, C, 0, v, !1), s.lineWidth = a, s.strokeStyle = l, s.stroke() } function y() { s.beginPath(), W < g && (W = w), W + g > u.width && (W = u.width - w), G < g && (G = w), G + g > u.height && (G = u.height - w), s.arc(W, G, g, 0, v, !1); var t = s.createRadialGradient(m, p, 5, m, p, 200); t.addColorStop(0, h), t.addColorStop(1, d), s.fillStyle = t, s.fill(), s.lineWidth = r, s.strokeStyle = d, s.stroke() } "ontouchstart" in document.documentElement ? (u.addEventListener("touchstart", function (t) { f = 1 }, !1), u.addEventListener("touchmove", function (t) { t.preventDefault(), 1 == f && (W = t.touches[0].pageX, G = t.touches[0].pageY, W -= u.offsetLeft, G -= u.offsetTop, s.clearRect(0, 0, u.width, u.height), x(), y()) }, !1), u.addEventListener("touchend", function (t) { f = 0, W = m, G = p, s.clearRect(0, 0, u.width, u.height), x(), y() }, !1)) : (u.addEventListener("mousedown", function (t) { f = 1 }, !1), u.addEventListener("mousemove", function (t) { 1 == f && (W = t.pageX, G = t.pageY, W -= u.offsetLeft, G -= u.offsetTop, s.clearRect(0, 0, u.width, u.height), x(), y()) }, !1), u.addEventListener("mouseup", function (t) { f = 0, W = m, G = p, s.clearRect(0, 0, u.width, u.height), x(), y() }, !1)), x(), y(), this.GetWidth = function () { return u.width }, this.GetHeight = function () { return u.height }, this.GetPosX = function () { return W }, this.GetPosY = function () { return G }, this.GetX = function () { return ((W - m) / w * 100).toFixed() }, this.GetY = function () { return ((G - p) / w * 100 * -1).toFixed() }, this.GetDir = function () { var t = "", e = W - m, i = G - p; return i >= k && i <= S && (t = "C"), i < k && (t = "N"), i > S && (t = "S"), e < E && ("C" == t ? t = "W" : t += "W"), e > L && ("C" == t ? t = "E" : t += "E"), t } };