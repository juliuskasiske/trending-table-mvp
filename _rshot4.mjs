import { chromium } from "playwright";
const b=await chromium.launch();const c=await b.newContext({viewport:{width:880,height:900},deviceScaleFactor:2});const p=await c.newPage();
await p.addInitScript(()=>localStorage.setItem("tt-lang","de"));
await p.goto("http://localhost:5174/register",{waitUntil:"networkidle"});await p.waitForTimeout(300);
await p.fill("#email",process.env.E);await p.fill("#password",process.env.P);await p.fill("#password2",process.env.P);
await p.click("[data-step='account'] [data-next]");await p.waitForTimeout(800);
await p.screenshot({path:process.env.OUT+"/register_taken_final.png"});
await b.close();
