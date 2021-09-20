#include <Arduino.h>
#include "Arduino.h"
#include <ArduinoWebsockets.h>

#if defined(ESP32)
  #include <WiFi.h>
#else
  #include <ESP8266WiFi.h>
#endif

#include <ESPAsyncWebServer.h>

//#include <TB6612_ESP32.h>
#include <L298NX2.h>

#include "config.h"
#include "web.h"

/** ESP32 robot tank with wifi and one joystick web control sketch. 
    Based on SMARS modular robot project using esp32 and tb6612.
    https://www.thingiverse.com/thing:2662828

    for complete complete program: https://github.com/nkmakes/SMARS-esp32

    Made by nkmakes.github.io, August 2020.

    -----------------------------------------
    Camera stream based upon:
    Based on Neil Kolban example for IDF: https://github.com/nkolban/esp32-snippets/blob/master/cpp_utils/tests/BLE%20Tests/SampleNotify.cpp
    Ported to Arduino ESP32 by Evandro Copercini
    Adapted by Manos Zeakis for ESP32 and TB6612FNG
*/

int pwm_A=D1;//Right side 
int pwm_B=D2;//Left side 
int dir_A=D3;//Right reverse 
int dir_B=D4;//Left reverse 

L298NX2 myMotors(pwm_A, dir_A, pwm_B, dir_B);


void setFullSpeedDirFromSigned(int speed_dir_A, int speed_dir_B) { 
  
  if (speed_dir_A>0){
    //     myMotors.setSpeedA(speed_dir_A); 
    digitalWrite(pwm_A, HIGH); 
    digitalWrite(dir_A, HIGH ); 
  } else if (speed_dir_A<0){
    digitalWrite(pwm_A, HIGH); 
    digitalWrite(dir_A, LOW); 
  }
  else{
    digitalWrite(pwm_A, LOW); 
  }

  if (speed_dir_B>0){
//     myMotors.setSpeedB(speed_dir_B); 
    digitalWrite(pwm_B, HIGH); 
    digitalWrite(dir_B, HIGH); 
  } else if (speed_dir_B<0){
    digitalWrite(pwm_B, HIGH); 
    digitalWrite(dir_B, LOW); 
  } else{
    digitalWrite(pwm_B, LOW); 
  }
}

void setSpeedDirFromSigned(int speed_dir_A, int speed_dir_B) { 
  
  if (speed_dir_A>0){
    //     myMotors.setSpeedA(speed_dir_A); 
    analogWrite(pwm_A, speed_dir_A); 
    digitalWrite(dir_A, HIGH ); 
  } else if (speed_dir_A<0){
    analogWrite(pwm_A, abs(speed_dir_A)); 
    digitalWrite(dir_A, LOW); 
  }
  else{
    digitalWrite(pwm_A, LOW); 
  }

  if (speed_dir_B>0){
//     myMotors.setSpeedB(speed_dir_B); 
    analogWrite(pwm_B, speed_dir_B); 
    digitalWrite(dir_B, HIGH); 
  } else if (speed_dir_B<0){
    analogWrite(pwm_B, abs (speed_dir_B)); 
    digitalWrite(dir_B, LOW); 
  } else{
    digitalWrite(pwm_B, LOW); 
  }
}

void setup()
{
  Serial.begin(115200);

  // Create AP
  WiFi.softAP(ssid, password);
  IPAddress IP = WiFi.softAPIP();
  Serial.print("AP IP address: ");
  Serial.println(IP);

  // HTTP handler assignment
  webserver.on("/", HTTP_GET, [](AsyncWebServerRequest * request) {
    AsyncWebServerResponse *response = request->beginResponse_P(200, "text/html", index_html);
    // response->addHeader("Content-Encoding", "gzip");
    response->addHeader("Server","ESP Async Web Server");
    request->send(response);    
  });

  // start server
  webserver.begin();
  server.listen(82);
  Serial.print("Server status: ");
  Serial.println(server.available());
 
}
 
// handle http messages
void handle_message(WebsocketsMessage msg) {
  commaIndex = msg.data().indexOf(',');
  LValue = msg.data().substring(0, commaIndex).toInt();
  RValue = msg.data().substring(commaIndex + 1).toInt();
  Serial.println("L: "+ String(LValue) + " R: " + String(RValue) );
  setSpeedDirFromSigned(LValue, RValue);
  //motor1.drive(LValue);
  //motor2.drive(RValue);
}
 
void loop()
{
  auto client = server.accept();
  client.onMessage(handle_message);
  while (client.available()) {
    client.poll();
  }
}


