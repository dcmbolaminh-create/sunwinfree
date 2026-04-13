const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// ⚡ API chính
const API_URL = "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

// ⚡ Axios chống treo
const axiosInstance = axios.create({
  timeout: 5000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json"
  }
});

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;

// ⚡ Cache data
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 3000;

// ⚡ Cache dự đoán
let cachedPrediction = { phien: null, prediction: null, dudoan_vi: "" };

function getResult(score) {
  return score >= 11 ? "Tài" : "Xỉu";
}

/* ================= AI PREDICT ================= */
function advancedPrediction(history) {
  if (history.length < 10) return getResult(history[0].score);

  let weightSum = 0;
  let scoreSum = 0;

  for (let i = 0; i < 10; i++) {
    let weight = (10 - i);
    scoreSum += history[i].score * weight;
    weightSum += weight;
  }

  const emaScore = scoreSum / weightSum;
  let trendPred = emaScore >= 10.5 ? "Tài" : "Xỉu";

  let lastResults = history.slice(0, 4).map(h => getResult(h.score));

  // 🔥 Bẻ cầu bệt
  let count = 1;
  for (let i = 0; i < history.length - 1; i++) {
    if (getResult(history[i].score) === getResult(history[i + 1].score)) count++;
    else break;
  }

  if (count >= 5) {
    return getResult(history[0].score) === "Tài" ? "Xỉu" : "Tài";
  }

  // 🔥 Cầu 1-1
  if (lastResults[0] !== lastResults[1] && lastResults[1] !== lastResults[2]) {
    return lastResults[0] === "Tài" ? "Xỉu" : "Tài";
  }

  return trendPred;
}

/* ================= RANDOM VỊ ================= */
function generateFixedVi(prediction) {
  const taiRange = [11, 12, 13, 14, 15, 16];
  const xiuRange = [4, 5, 6, 7, 8, 9, 10];

  const range = prediction === "Tài" ? taiRange : xiuRange;

  const shuffled = [...range].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3).sort((a, b) => a - b).join(",");
}

/* ================= KEEP ALIVE ================= */
// ⚡ chống sleep Render
setInterval(async () => {
  try {
    await axiosInstance.get(`http://localhost:${PORT}/sun/sicbo`);
    console.log("♻️ Self ping keep alive");
  } catch (e) {}
}, 1000 * 60 * 5); // 5 phút ping 1 lần

/* ================= ENDPOINT ================= */
app.get("/sun/sicbo", async (req, res) => {
  try {
    const now = Date.now();

    // ⚡ Cache
    if (cachedData && (now - cacheTimestamp) < CACHE_DURATION) {
      return res.json(cachedData);
    }

    // ⚡ Chống spam API
    if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
      await new Promise(r =>
        setTimeout(r, MIN_REQUEST_INTERVAL - (now - lastRequestTime))
      );
    }

    lastRequestTime = Date.now();

    const response = await axiosInstance.get(API_URL);
    const resultList = response?.data?.data?.resultList;

    if (!resultList || resultList.length === 0) {
      throw new Error("No data");
    }

    const current = resultList[0];
    const currentPhienStr = current.gameNum.replace("#", "");

    // ⚡ FIX BIGINT
    const nextPhienStr = (BigInt(currentPhienStr) + 1n).toString();

    // ⚡ Update dự đoán khi sang phiên
    if (cachedPrediction.phien !== nextPhienStr) {
      const pred = advancedPrediction(resultList);

      cachedPrediction = {
        phien: nextPhienStr,
        prediction: pred,
        dudoan_vi: generateFixedVi(pred)
      };
    }

    const finalResult = {
      phien: currentPhienStr,
      xuc_xac_1: current.facesList[0],
      xuc_xac_2: current.facesList[1],
      xuc_xac_3: current.facesList[2],
      tong: current.score,
      ket_qua: getResult(current.score),

      phien_hien_tai: cachedPrediction.phien,
      du_doan: cachedPrediction.prediction,
      dudoan_vi: cachedPrediction.dudoan_vi
    };

    cachedData = finalResult;
    cacheTimestamp = now;

    res.json(finalResult);

  } catch (error) {
    console.error("❌ API ERROR:", error.message);

    if (cachedData) {
      return res.json(cachedData);
    }

    res.status(500).json({
      error: "API lỗi nhưng vẫn giữ server sống 😎"
    });
  }
});

/* ================= ROOT ================= */
// ⚡ để Render không báo lỗi
app.get("/", (req, res) => {
  res.send("🚀 API SICBO VIP RUNNING...");
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại: http://localhost:${PORT}/sun/sicbo`);
});
