const express = require("express");
const axios = require("axios");

const app = express();
const PORT = 3000;

const API_URL = "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

const axiosInstance = axios.create();
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5000; // Cập nhật nhanh hơn để bám sát phiên

// Bộ nhớ đệm dự đoán cố định theo phiên
let cachedPrediction = { phien: null, prediction: null, dudoan_vi: "" };

function getResult(score) {
  return score >= 11 ? "Tài" : "Xỉu";
}

/* --- THUẬT TOÁN DỰ ĐOÁN XỊN (EMA + PATTERN) --- */
function advancedPrediction(history) {
  if (history.length < 10) return getResult(history[0].score);

  // 1. Tính toán xu hướng dựa trên trọng số (EMA - Những phiên gần nhất có trọng số cao hơn)
  let weightSum = 0;
  let scoreSum = 0;
  for (let i = 0; i < 10; i++) {
    let weight = (10 - i); // Phiên gần nhất (index 0) nặng nhất
    scoreSum += history[i].score * weight;
    weightSum += weight;
  }
  const emaScore = scoreSum / weightSum;
  let trendPred = emaScore >= 10.5 ? "Tài" : "Xỉu";

  // 2. Nhận diện cầu (Pattern Recognition)
  let lastResults = history.slice(0, 4).map(h => getResult(h.score));
  
  // Bẻ cầu bệt dài (Nếu ra 5 lần liên tiếp cùng loại thì bẻ)
  let count = 1;
  for (let i = 0; i < history.length - 1; i++) {
    if (getResult(history[i].score) === getResult(history[i+1].score)) count++;
    else break;
  }
  if (count >= 5) return getResult(history[0].score) === "Tài" ? "Xỉu" : "Tài";

  // Cầu 1-1 (Tài-Xỉu-Tài-Xỉu)
  if (lastResults[0] !== lastResults[1] && lastResults[1] !== lastResults[2]) {
    return lastResults[0] === "Tài" ? "Xỉu" : "Tài";
  }

  return trendPred;
}

/* --- RANDOM VỊ CỐ ĐỊNH THEO PHIÊN --- */
function generateFixedVi(prediction) {
  const taiRange = [11, 12, 13, 14, 15, 16];
  const xiuRange = [4, 5, 6, 7, 8, 9, 10];
  const range = prediction === "Tài" ? taiRange : xiuRange;
  
  // Trộn mảng và lấy 3 số ngẫu nhiên
  const shuffled = [...range].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3).sort((a, b) => a - b).join(",");
}

/* --- ENDPOINT CHÍNH --- */
app.get("/sun/sicbo", async (req, res) => {
  try {
    const now = Date.now();
    if (cachedData && (now - cacheTimestamp) < CACHE_DURATION) {
      return res.json(cachedData);
    }

    if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - (now - lastRequestTime)));
    }
    lastRequestTime = Date.now();

    const response = await axiosInstance.get(API_URL);
    const resultList = response.data.data.resultList;
    if (!resultList || resultList.length === 0) return res.status(500).json({ error: "No data" });

    const current = resultList[0];
    const currentPhienStr = current.gameNum.replace("#", "");
    
    // Tính toán số phiên tiếp theo (Logic xử lý chuỗi số lớn)
    const nextPhienStr = (BigInt(currentPhienStr) + 1n).toString();

    // CHỈ CẬP NHẬT DỰ ĐOÁN KHI QUA PHIÊN MỚI
    if (cachedPrediction.phien !== nextPhienStr) {
      const pred = advancedPrediction(resultList);
      cachedPrediction = {
        phien: nextPhienStr,
        prediction: pred,
        dudoan_vi: generateFixedVi(pred) // Chỉ random 1 lần ở đây
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
    console.error(error);
    if (cachedData) return res.json(cachedData);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API Running at: http://localhost:${PORT}/sun/sicbo`);
});
