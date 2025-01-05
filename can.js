"use strict";

const fs = require("fs");
const tls = require("tls");
const WebSocket = require("ws");
const extractJson = require("extract-json-from-string");
const http2 = require("http2");
const colors = require("colors");
const axios = require("axios");
const path = require("path");

const { token, gId, password, whURL } = JSON.parse(fs.readFileSync("config.json"));

process.title = `canqu url sniper`;

let currentVanity;
let multiFactorToken = "";
const guildData = {};
let missingVanityCount = 0;

console.clear();
console.log(colors.green("Sniper active!"));

const delayGenerator = {
  generate: () => Math.floor(Math.random() * 300) + 100,
};

const tlsConnection = tls.connect({ host: "discord.com", port: 443 });

tlsConnection.on("data", (chunk) => {
  const extractedData = extractJson(chunk.toString());
  const relevantData = extractedData.find((entry) => entry.code || entry.message);

  if (relevantData) {
  }
});

async function notifyWebhook(vanityCode) {
  const delay = delayGenerator.generate();
  const payload = {
    content: `@everyone Updated Vanity URL: ${vanityCode}\n\`\`\`json\n${JSON.stringify(vanityCode)}\n\`\`\`\nDelay: ${delay}ms`,
  };

  try {
    await axios.post(whURL, payload);
  } catch (error) {
    console.error("Webhook notification failed:", error);
  }
}

tlsConnection.on("error", () => process.exit());
tlsConnection.on("end", () => process.exit());

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/100.0",
  Authorization: token,
  "Content-Type": "application/json",
};

async function processVanityRequest(vanityCode) {
  try {
    const response = await sendHttp2Request("PATCH", `/api/v10/guilds/${gId}/vanity-url`, defaultHeaders);
    const responseData = JSON.parse(response);

    if (responseData.code === 200) {
      updateVanityURL(vanityCode);
    } else if (responseData.code === 60003) {
      const mfaTicket = responseData.mfa.ticket;
      await handleMfaProcess(mfaTicket, vanityCode);
    } else {
      console.log(colors.red("Error Code:", responseData.code));
    }
  } catch (error) {
    console.error(colors.red("Request Error:", error));
  }
}

async function handleMfaProcess(ticket, vanityCode) {
  try {
    const mfaResponse = await sendHttp2Request(
      "POST",
      "/api/v10/mfa/finish",
      { ...defaultHeaders, "Content-Type": "application/json" },
      JSON.stringify({
        ticket: ticket,
        mfa_type: "password",
        data: password,
      })
    );

    const responseData = JSON.parse(mfaResponse);

    if (responseData.token) {
      multiFactorToken = responseData.token;
      updateVanityURL(vanityCode);
    } else {
      throw new Error(`MFA Error: ${JSON.stringify(responseData)}`);
    }
  } catch (error) {
    console.error(colors.red("MFA Process Error:", error));
  }
}

async function updateVanityURL(vanityCode) {
  try {
    const delay = delayGenerator.generate();
    const response = await sendHttp2Request(
      "PATCH",
      `/api/v10/guilds/${gId}/vanity-url`,
      {
        ...defaultHeaders,
        "X-Discord-MFA-Authorization": multiFactorToken,
        Cookie: `__Secure-recent_mfa=${multiFactorToken}`,
      },
      JSON.stringify({ code: vanityCode })
    );

    const responseData = JSON.parse(response);

    if (responseData.code === 200) {
      console.log(colors.blue("Vanity URL successfully updated:", responseData));
    } else {
      console.error(colors.blue("Vanity URL update error:", responseData));
    }
  } catch (error) {
    console.error(colors.red("Update Error:", error));
  }
}

async function sendHttp2Request(method, endpoint, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const client = http2.connect("https://discord.com");
    const request = client.request({ ":method": method, ":path": endpoint, ...headers });

    let responseData = "";

    request.on("response", (headers, flags) => {
      request.on("data", (chunk) => {
        responseData += chunk;
      });
      request.on("end", () => {
        resolve(responseData);
        client.close();
      });
    });

    request.on("error", (error) => {
      reject(error);
      client.close();
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

tlsConnection.on("secureConnect", () => {
  const ws = new WebSocket("wss://gateway.discord.gg");

  ws.onclose = () => process.exit();

  ws.onmessage = (message) => {
    const { d, op, t } = JSON.parse(message.data);

    if (t === "GUILD_UPDATE") {
      const vanityCode = guildData[d.guild_id];

      if (vanityCode && vanityCode !== d.vanity_url_code) {
        processVanityRequest(vanityCode);
        notifyWebhook(vanityCode);
        currentVanity = `${vanityCode}`;
      }
    } else if (t === "GUILD_DELETE") {
      const vanityCode = guildData[d.id];

      if (vanityCode) {
        processVanityRequest(vanityCode);
        notifyWebhook(vanityCode);
        currentVanity = `${vanityCode}`;
      }
    } else if (t === "READY") {
      d.guilds.forEach((guild) => {
        if (guild.vanity_url_code) {
          guildData[guild.id] = guild.vanity_url_code;
          console.log(colors.cyan(`Server ID: ${guild.id}\nServer Name: ${guild.name}\nVanity URL: ${guild.vanity_url_code}\n`));
        } else {
          missingVanityCount++;
        }
      });
      if (missingVanityCount > 0) {
        console.log(colors.red(`Vanity URL Not Found: ${missingVanityCount} server(s)`));
      }
      console.log(colors.green("Made by Canqu - github.com/Yan-Jobs"));
    }

    if (op === 10) {
      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token: token,
            intents: 32767,
            properties: { os: "iOS", browser: "google", device: "" },
          },
        })
      );

      setInterval(
        () => ws.send(JSON.stringify({ op: 1, d: {}, s: null, t: "heartbeat" })),
        d.heartbeat_interval
      );
    } else if (op === 7) {
      process.exit();
    }
  };

  setInterval(() => tlsConnection.write(["GET / HTTP/1.1", "Host: discord.com", "", ""].join("\r\n")), 400);
});

console.log("Vanity URL Service is Active");
