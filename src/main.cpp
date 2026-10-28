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

WebsocketsClient client;
unsigned long lastCommandMs = 0;
bool hasReceivedCommand = false;
const unsigned long COMMAND_TIMEOUT_MS = 500;

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

void setMotor1(int speed);
void setMotor2(int speed);
void setMotor3(int speed);

void stopAll()
{
    // Detener las cuatro ruedas
    setFL(0);
    setFR(0);
    setRL(0);
    setRR(0);

    // Detener los motores auxiliares
    setMotor1(0);
    setMotor2(0);
    setMotor3(0);
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
    WiFi.softAP(ssid, password);
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

    // Serve all files from root
    webserver.serveStatic("/", LittleFS, "/");
    webserver.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
        request->send(LittleFS, "/index.html", "text/html");
    });  

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
 
// ============================================================
// WebSocket message handler
// Expected format:
// forward,strafe,rotate,motor1,motor2,motor3,servoPosition
// ============================================================

void handle_message(WebsocketsMessage msg)
{
    String data = msg.data();

    // Locate the six separators required for seven values.
    int p[6];

    int start = 0;

    for (int i = 0; i < 6; i++)
    {
        p[i] = data.indexOf(',', start);

        // Reject malformed or incomplete messages.
        if (p[i] < 0)
            return;

        start = p[i] + 1;
    }

    // Parse the three drive commands.
    forward = data.substring(0, p[0]).toInt();
    strafe  = data.substring(p[0] + 1, p[1]).toInt();
    rotate  = data.substring(p[1] + 1, p[2]).toInt();

    // Parse the three auxiliary DC motor commands.
    motor1 = data.substring(p[2] + 1, p[3]).toInt();
    motor2 = data.substring(p[3] + 1, p[4]).toInt();
    motor3 = data.substring(p[4] + 1, p[5]).toInt();

    // Parse the auxiliary servo position.
    servoPosition = data.substring(p[5] + 1).toInt();

    // Apply the drive commands.
    driveMecanum(
        constrain(forward, -100, 100),
        constrain(strafe, -100, 100),
        constrain(rotate, -100, 100)
    );

    // Apply the auxiliary motor commands.
    setMotor1(motor1);
    setMotor2(motor2);
    setMotor3(motor3);

    // Apply the servo command.
    setServoPosition(servoPosition);

    // Print the received commands for debugging.
    Serial.printf(
        "F:%d S:%d R:%d | M1:%d M2:%d M3:%d | SV:%d\n",
        forward, strafe, rotate,
        motor1, motor2, motor3,
        servoPosition
    );
    lastCommandMs = millis();
hasReceivedCommand = true;
}



void loop()
{
    ArduinoOTA.handle();

    if (!client.available())
    {
        client = server.accept();

        if (client.available())
        {
            client.onMessage(handle_message);
            Serial.println("WS client connected");
        }
    }

    if (client.available())
    {
        client.poll();
    }
// Seguridad ante perdida de comunicacion
if (hasReceivedCommand &&
    (!client.available() ||
     millis() - lastCommandMs > COMMAND_TIMEOUT_MS))
{
    stopAll();
    hasReceivedCommand = false;
    Serial.println("SAFETY: Communication timeout");
}
    yield();
}


