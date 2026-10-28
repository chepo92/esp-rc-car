#include <Arduino.h>
#include "Arduino.h"
#include <ArduinoWebsockets.h>
#include <ArduinoOTA.h>

#if defined(ESP32)
  #include <WiFi.h>
  #include <ESP32Servo.h>
#else
  #include <ESP8266WiFi.h>
#endif

#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "config.h"

using namespace websockets;
WebsocketsServer server;
AsyncWebServer webserver(80);

// ============================================================
// MULTI-CLIENT WEBSOCKET
// ============================================================
const uint8_t MAX_WS_CLIENTS = 4;

WebsocketsClient clients[MAX_WS_CLIENTS];
bool clientConnected[MAX_WS_CLIENTS] = { false };
String clientRole[MAX_WS_CLIENTS] = { "", "", "" };

const char* allowedRoles[] = {
    "drive",
    "servo",
    "aux"
};


// ============================================================
// Movement commands received from the WebSocket client
// ============================================================

int forward;  // Longitudinal movement command: forward (+), backward (-)
int strafe;   // Lateral movement command: right (+), left (-)
int rotate;   // Rotation command around the vertical axis
int aux;      // Auxiliary command reserved for future controls


// ============================================================
// Calculated motor outputs
// ============================================================

int motorFL;  // Front-left motor output (-255 to 255)
int motorFR;  // Front-right motor output (-255 to 255)
int motorRL;  // Rear-left motor output (-255 to 255)
int motorRR;  // Rear-right motor output (-255 to 255)


// ============================================================
// Motor configuration
// ============================================================

const bool invertFL = false;  // Reverse front-left motor direction
const bool invertFR = true;   // Reverse front-right motor direction
const bool invertRL = false;  // Reverse rear-left motor direction
const bool invertRR = false;  // Reverse rear-right motor direction

bool motorTestMode = false;   // Enable individual motor testing mode


// ============================================================
// Servo commands received from the WebSocket client
// ============================================================

// ============================================================
// Auxiliary servo configuration
// ============================================================

#if defined(ESP32)
  Servo auxServo;             // Auxiliary servo controller
#endif


int servoPosition = 0;     // Logical servo position: 0 to 100

// Adjustable servo travel limits, in microseconds.
// These limits can be tuned to match the mechanism.
int servoMinPulseUs = 1000;
int servoMaxPulseUs = 2000;



// ============================================================
// Auxiliary motor commands
// Logical range: -100 to 100
// ============================================================

int motor1 = 0;  // Auxiliary motor 1 command
int motor2 = 0;  // Auxiliary motor 2 command
int motor3 = 0;  // Auxiliary motor 3 command



void setMotor(int pwmPin, int dirPin, int value)
{
    value = constrain(value, -255, 255);

    if (value > 0)
    {
        analogWrite(pwmPin, value);
        digitalWrite(dirPin, HIGH);
    }
    else if (value < 0)
    {
        analogWrite(pwmPin, abs(value));
        digitalWrite(dirPin, LOW);
    }
    else
    {
        analogWrite(pwmPin, 0);
    }
}


void setMotorTA6586(
    int pinA,
    int pinB,
    int value
)
{
    value = constrain(value, -255, 255);

    if(value > 0)
    {
        analogWrite(pinA, value);
        analogWrite(pinB, 0);
    }
    else if(value < 0)
    {
        analogWrite(pinA, 0);
        analogWrite(pinB, -value);
    }
    else
    {
        analogWrite(pinA, 0);
        analogWrite(pinB, 0);
    }
}

void setFL(int v)
{
    if (invertFL) v = -v;
    setMotor(pwm_FL, dir_FL, v);
}

void setFR(int v)
{
    if (invertFR) v = -v;
    setMotor(pwm_FR, dir_FR, v);
}

void setRL(int v)
{
    if (invertRL) v = -v;
    setMotorTA6586(pwm_RL, dir_RL, v);
}

void setRR(int v)
{
    if (invertRR) v = -v;
    setMotorTA6586(pwm_RR, dir_RR, v);
}

void driveMecanum(int forward, int strafe, int rotate)
{
    motorFL = forward + strafe - rotate;
    motorFR = forward - strafe + rotate;
    motorRL = forward - strafe - rotate;
    motorRR = forward + strafe + rotate;

    int maxValue = max(
        max(abs(motorFL), abs(motorFR)),
        max(abs(motorRL), abs(motorRR))
    );

    if (maxValue > 100)
    {
        motorFL = motorFL * 100 / maxValue;
        motorFR = motorFR * 100 / maxValue;
        motorRL = motorRL * 100 / maxValue;
        motorRR = motorRR * 100 / maxValue;
    }

    motorFL = map(motorFL, -100, 100, -255, 255);
    motorFR = map(motorFR, -100, 100, -255, 255);
    motorRL = map(motorRL, -100, 100, -255, 255);
    motorRR = map(motorRR, -100, 100, -255, 255);

    setFL(motorFL);
    setFR(motorFR);
    setRL(motorRL);
    setRR(motorRR);

    Serial.printf(
        "FL[pwm=%d dir=%d]=%4d  "
        "FR[pwm=%d dir=%d]=%4d  "
        "RL[pwm=%d dir=%d]=%4d  "
        "RR[pwm=%d dir=%d]=%4d\n",

        pwm_FL, dir_FL, motorFL,
        pwm_FR, dir_FR, motorFR,
        pwm_RL, dir_RL, motorRL,
        pwm_RR, dir_RR, motorRR
    );
}

void stopAll()
{
    setFL(0);
    setFR(0);
    setRL(0);
    setRR(0);
}

// ====== TEST POR MOTOR ======
void testMotor(const char* name, void (*motorFn)(int))
{
    Serial.printf("\n=== TEST %s FORWARD ===\n", name);
    motorFn(150);
    delay(2000);

    Serial.printf("=== TEST %s BACKWARD ===\n", name);
    motorFn(-150);
    delay(2000);

    stopAll();
    delay(1000);
}


// ============================================================
// Bidirectional auxiliary DC motor control
// ============================================================

void setAuxMotor(int pinA, int pinB, int speed)
{
    // Restrict the command to the logical range.
    speed = constrain(speed, -100, 100);

    // Convert speed magnitude to an 8-bit PWM duty cycle.
    int pwm = map(abs(speed), 0, 100, 0, 255);

    if (speed > 0)
    {
        // Forward: PWM on input A, input B LOW.
        analogWrite(pinA, pwm);
        analogWrite(pinB, 0);
    }
    else if (speed < 0)
    {
        // Reverse: input A LOW, PWM on input B.
        analogWrite(pinA, 0);
        analogWrite(pinB, pwm);
    }
    else
    {
        // Stop: both inputs LOW.
        analogWrite(pinA, 0);
        analogWrite(pinB, 0);
    }
}


// ============================================================
// Individual auxiliary motor functions
// ============================================================

void setMotor1(int speed)
{
    motor1 = constrain(speed, -100, 100);
    setAuxMotor(pwm_M1, dir_M1, motor1);
}

void setMotor2(int speed)
{
    motor2 = constrain(speed, -100, 100);
    setAuxMotor(pwm_M2, dir_M2, motor2);
}

void setMotor3(int speed)
{
    motor3 = constrain(speed, -100, 100);
    setAuxMotor(pwm_M3, dir_M3, motor3);
}


// ============================================================
// Auxiliary servo control
// Logical range: 0 to 100
// ============================================================

void setServoPosition(int position)
{
    // Restrict the command to the logical range.
    position = constrain(position, 0, 100);

    // Map the logical position to the configured pulse limits.
    int pulseUs = map(
        position,
        0, 100,
        servoMinPulseUs, servoMaxPulseUs
    );

    // Apply the target position to the servo.
    auxServo.writeMicroseconds(pulseUs);

    // Store the last requested position.
    servoPosition = position;
}


void printFilesystemInfo()
{
#if defined(ESP8266)

    FSInfo fs_info;

    if (LittleFS.info(fs_info))
    {
        Serial.printf("Filesystem total: %u bytes\n",
                      (unsigned int)fs_info.totalBytes);

        Serial.printf("Filesystem used: %u bytes\n",
                      (unsigned int)fs_info.usedBytes);
    }

#elif defined(ESP32)

    size_t totalBytes = LittleFS.totalBytes();
    size_t usedBytes  = LittleFS.usedBytes();

    Serial.printf("Filesystem total: %u bytes\n",
                  (unsigned int)totalBytes);

    Serial.printf("Filesystem used: %u bytes\n",
                  (unsigned int)usedBytes);

#endif
}

void stopRole(const String& role) {
    if (role == "conductor") {
        driveMecanum(0, 0, 0);
    }
    else if (role == "auxiliar") {
        setMotor1(0);
        setMotor2(0);
        setMotor3(0);
    }
    // El servo conserva su última posición.
}

bool roleIsTaken(const String& role, int exceptSlot = -1) {
    for (uint8_t i = 0; i < MAX_WS_CLIENTS; i++) {
        if (i != exceptSlot &&
            clientConnected[i] &&
            clientRole[i] == role) {
            return true;
        }
    }
    return false;
}

 
// ============================================================
// WebSocket message handler
// Expected format:
// 
// ============================================================
void handleClientMessage(uint8_t slot, WebsocketsMessage msg) {
    String data = msg.data();

    // Exigir asignación de rol antes de aceptar comandos.
    if (clientRole[slot].isEmpty()) {
        if (!data.startsWith("ROLE,")) {
            clients[slot].send("ROLE_REQUIRED");
            return;
        }

        String role = data.substring(5);

        if (role != "conductor" &&
            role != "servo" &&
            role != "auxiliar") {
            clients[slot].send("ROLE_DENIED");
            return;
        }

        if (roleIsTaken(role, slot)) {
            clients[slot].send("ROLE_BUSY");
            return;
        }

        clientRole[slot] = role;
        clients[slot].send("ROLE_OK," + role);

        Serial.printf("Cliente %u asignado: %s\n",
                      slot, role.c_str());
        return;
    }

    // Conductor: DRIVE,adelante,lateral,giro
    if (clientRole[slot] == "conductor") {
        if (!data.startsWith("DRIVE,")) return;

        int p1 = data.indexOf(',');
        int p2 = data.indexOf(',', p1 + 1);
        int p3 = data.indexOf(',', p2 + 1);

        if (p1 < 0 || p2 < 0 || p3 < 0) return;

        int forward = data.substring(p1 + 1, p2).toInt();
        int strafe  = data.substring(p2 + 1, p3).toInt();
        int rotate  = data.substring(p3 + 1).toInt();

        driveMecanum(
            constrain(forward, -100, 100),
            constrain(strafe, -100, 100),
            constrain(rotate, -100, 100)
        );
    }

    // Servo: SERVO,posicion
    else if (clientRole[slot] == "servo") {
        if (!data.startsWith("SERVO,")) return;

        int position = data.substring(6).toInt();
        setServoPosition(constrain(position, 0, 180));
    }

    // Auxiliar: AUX,motor,velocidad
    else if (clientRole[slot] == "auxiliar") {
        if (!data.startsWith("AUX,")) return;

        int comma = data.indexOf(',', 4);
        if (comma < 0) return;

        int motor = data.substring(4, comma).toInt();
        int speed = constrain(data.substring(comma + 1).toInt(),
                              -100, 100);

        switch (motor) {
            case 1: setMotor1(speed); break;
            case 2: setMotor2(speed); break;
            case 3: setMotor3(speed); break;
            default: return;
        }
    }
}





 
void acceptWebSocketClients() {
    if (!server.poll()) return;

    WebsocketsClient newClient = server.accept();

    if (!newClient.available()) return;

    int slot = -1;

    for (uint8_t i = 0; i < MAX_WS_CLIENTS; i++) {
        if (!clientConnected[i]) {
            slot = i;
            break;
        }
    }

    if (slot < 0) {
        newClient.close();
        Serial.println("WS: capacidad completa");
        return;
    }

    clients[slot] = newClient;
    clientConnected[slot] = true;
    clientRole[slot] = "";

    clients[slot].onMessage([slot](WebsocketsMessage msg) {
        handleClientMessage(slot, msg);
    });

    Serial.printf("WS: cliente conectado en slot %d\n", slot);
}

void serviceWebSocketClients() {
    for (uint8_t i = 0; i < MAX_WS_CLIENTS; i++) {
        if (!clientConnected[i]) continue;

        if (clients[i].available()) {
            clients[i].poll();
        }

        if (clientConnected[i] && !clients[i].available()) {
            String role = clientRole[i];

            Serial.printf("WS: desconectado slot %d, rol %s\n",
                          i, role.c_str());

            // Detener el subsistema antes de liberar el slot.
            stopRole(role);

            clientRole[i] = "";
            clientConnected[i] = false;
        }
    }
}

void setup()
{
    Serial.begin(115200);
    Serial.println("");

    #if defined(ESP8266)
        ESP.wdtEnable(5000);
    #elif defined(ESP32)
        // Configure the ESP32 watchdog here only if required.
        // The API depends on the installed Arduino-ESP32 version.
    #endif

    // Mount FS
    if (!LittleFS.begin())
    {
        Serial.println("LittleFS mount failed");
        return;
    }

    printFilesystemInfo();

    pinMode(pwm_FL, OUTPUT);
    pinMode(dir_FL, OUTPUT);

    pinMode(pwm_FR, OUTPUT);
    pinMode(dir_FR, OUTPUT);

    pinMode(pwm_RL, OUTPUT);
    pinMode(dir_RL, OUTPUT);

    pinMode(pwm_RR, OUTPUT);
    pinMode(dir_RR, OUTPUT);


    // Configure auxiliary motor pins.
    pinMode(pwm_M1, OUTPUT);
    pinMode(dir_M1, OUTPUT);

    pinMode(pwm_M2, OUTPUT);
    pinMode(dir_M2, OUTPUT);

    pinMode(pwm_M3, OUTPUT);
    pinMode(dir_M3, OUTPUT);

    // Ensure all auxiliary motors start stopped.
    setMotor1(0);
    setMotor2(0);
    setMotor3(0);

    // Configure the servo pulse range and attach its signal pin.
    auxServo.attach(servoPin, servoMinPulseUs, servoMaxPulseUs);

    // Initialize the servo at logical position zero.
    setServoPosition(0);

    String chipHex;

    #if defined(ESP8266)

        chipHex = String(ESP.getChipId(), HEX);

    #elif defined(ESP32)

        chipHex = String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFFULL), HEX);

    #endif

    // Create a unique wifi ssid
    
    chipHex.toUpperCase();
    String ssid = String(ssid_base) + chipHex;

    // Create AP
    WiFi.softAP(ssid, password, 1, false, 4);
    IPAddress IP = WiFi.softAPIP();
    Serial.println("Wifi Name: " + ssid);
    Serial.println("Password: " + String(password) );
    Serial.print("AP IP address: ");
    Serial.println(IP);

    ArduinoOTA.setHostname(ssid.c_str());

    ArduinoOTA.onStart([]() {
        Serial.println("OTA Start");
    });

    ArduinoOTA.onEnd([]() {
        Serial.println("\nOTA End");
    });

    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf(
            "OTA Progress: %u%%\r",
            (progress * 100) / total
        );
    });

    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf(
            "OTA Error[%u]\n",
            error
        );
    });

    ArduinoOTA.begin();

    Serial.print("Free heap: ");
    Serial.println(ESP.getFreeHeap());

    Serial.println("OTA Ready");  
    Serial.print("OTA IP: ");
    Serial.println(WiFi.softAPIP());
    Serial.print("OTA Hostname: ");
    Serial.println(ssid);

    // Seleccion de roles
webserver.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (request->hasParam("role")) {
        String role = request->getParam("role")->value();

        if (role == "conductor" ||
            role == "auxiliar" ||
            role == "servo") {
            request->send(LittleFS, "/index.html", "text/html");
            return;
        }
    }

    request->send(LittleFS, "/landing.html", "text/html");
});

// Servir los demas archivos
webserver.serveStatic("/", LittleFS, "/");

    // start server
    webserver.begin();
    server.listen(82);

    // Verbose
    Serial.print("Server status: ");
    Serial.println(server.available());

    if (motorTestMode)
    {
    delay(2000);   // tiempo para abrir serial monitor
    Serial.println("\n===== MOTOR TEST START =====");
    testMotor("FL", setFL);
    testMotor("FR", setFR);
    testMotor("RL", setRL);
    testMotor("RR", setRR);
    Serial.println("===== MOTOR TEST END =====\n");
    }
 
}


void loop()
{
    ArduinoOTA.handle();

    acceptWebSocketClients();
    serviceWebSocketClients();

    yield();
}


