import { chromium } from "playwright";
const BASE="http://localhost:5174", TOK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMiIsInR5cCI6ImNyZWF0b3IiLCJldiI6ZmFsc2UsImlhdCI6MTc4MzUyMDE5OSwiZXhwIjoxNzg0MTI0OTk5fQ.0iY__q5lnA3zMxIrm1ML26ki_51iKwfZilhk7Qapgcs";
const OUT="/private/tmp/claude-501/-Users-juliuskasiske-Documents-trending-table/635a2c21-1c0c-41b9-87a8-e65fde0dbac8/scratchpad";
const b=await chromium.launch();const c=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});const p=await c.newPage();
await p.addInitScript(t=>{localStorage.setItem("tt_token",t);localStorage.setItem("tt-lang","de");},TOK);
await p.goto(`${BASE}/creator`,{waitUntil:"networkidle"});await p.waitForTimeout(500);
await p.fill("#cp-name","Fran");await p.fill("#cp-age","27");await p.selectOption("#cp-gender","female");await p.fill("#cp-followers","48000");
await p.click("#cp-save");await p.waitForTimeout(700);
// measure the 3 metric input tops for instagram
const tops=await p.$$eval("#v-instagram,#r-instagram,#l-instagram",els=>els.map(e=>Math.round(e.getBoundingClientRect().top)));
console.log("IG metric input tops:", JSON.stringify(tops), "| aligned:", new Set(tops).size===1);
// also profile-step ch-stats (age/gender/followers) — re-render profile? it's on channels now. Check tiktok too
const ttt=await p.$$eval("#v-tiktok,#r-tiktok,#l-tiktok",els=>els.map(e=>Math.round(e.getBoundingClientRect().top)));
console.log("TikTok metric input tops:", JSON.stringify(ttt), "| aligned:", new Set(ttt).size===1);
await p.screenshot({path:`${OUT}/align-metrics.png`,clip:{x:180,y:0,width:1080,height:1200}});
await b.close();
