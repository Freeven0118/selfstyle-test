import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { QUESTIONS, OPTIONS, CATEGORY_INFO, PERSONAS, EXPERT_CONFIG, CATEGORY_IMAGES, LOADING_TIPS } from './constants';
import { Category } from './types';
import Chart from 'chart.js/auto';

// ------------------------------------------------------------------
// 設定區：正式環境 n8n Webhook URL
// ------------------------------------------------------------------
const N8N_WEBHOOK_URL = 'https://linegpt.menspalais.com/webhook/style-quiz'; 

// 定義 AI 回傳的報告結構
interface AiReport {
  selectedPersonaId: string; 
  personaExplanation: string; 
  personaOverview: string; 
  skinAnalysis: string;     // 對應 面容氣色
  hairAnalysis: string;     // 對應 髮型駕馭
  styleAnalysis: string;    // 對應 穿搭策略
  socialAnalysis: string;   // 對應 社群形象
  coachGeneralAdvice: string; 
}

const App: React.FC = () => {
  // 狀態管理
  const [step, setStep] = useState<'hero' | 'quiz' | 'diagnosing' | 'result'>('hero');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isIntroMode, setIsIntroMode] = useState(true);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  
  const [aiAnalysis, setAiAnalysis] = useState<AiReport | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [fakeProgress, setFakeProgress] = useState(0);

  // 用於錯誤處理與手動 Key
  const [customApiKey, setCustomApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  
  // 使用者資料與寄送狀態
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState(''); // 儲存使用者姓名
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [isResultUnlocked, setIsResultUnlocked] = useState(false); // 控制結果是否解鎖

  // Refs
  const aiFetchingRef = useRef(false); // 防止重複呼叫 AI
  const lastFetchTimeRef = useRef<number>(0); // 防止 React StrictMode 導致的瞬間雙重請求
  const radarChartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<any>(null);
  const dimensionsRef = useRef<HTMLDivElement | null>(null);

  // 用於邏輯的狀態 (不顯示於 UI)
  const [lastError, setLastError] = useState<string>('');
  
  // Loading Tips State
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [showTip, setShowTip] = useState(true);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);

  // ------------------------------------------------------------
  // 1. 偵測網址參數
  // ------------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 檢查是否有 start=true
    if (params.get('start') === 'true') {
      handleStart();
    }
    
    // 嘗試抓取 Email
    const emailParam = params.get('email');
    if (emailParam) {
        setUserEmail(emailParam);
        setIsResultUnlocked(true); // 如果網址帶 email，直接解鎖
    }
  }, []);

  // Loading Tips Animation Loop
  useEffect(() => {
    if (step === 'diagnosing' && !lastError) {
      const interval = setInterval(() => {
        setShowTip(false);
        setTimeout(() => {
          setCurrentTipIndex((prev) => (prev + 1) % LOADING_TIPS.length);
          setShowTip(true);
        }, 500); // Wait for fade out
      }, 4000); // Change every 4 seconds
      return () => clearInterval(interval);
    }
  }, [step, lastError]);

  // 文字格式化工具函數 (解析 **重點** 語法) - 用於 React 渲染
  // [修正] 預設 highlightClass 改為 'text-[#edae26]' (使用者指定的新金色)
  const renderFormattedText = (text: string, highlightClass: string = 'text-[#edae26]') => {
    if (!text) return null;
    
    return text.split('**').map((part, index) => 
      index % 2 === 1 ? (
        <span key={index} className={`${highlightClass} font-black`}>
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  // 轉換成 HTML 字串工具 (用於 Email Payload)
  // 將 **文字** 轉為 <strong style="...">文字</strong>
  // [修正] 預設 highlightColor 改為 #edae26 (使用者指定的新金色)
  const convertToHtmlString = (text: string, highlightColor: string = '#edae26') => {
    if (!text) return '';
    // 先處理換行
    let html = text.replace(/\n/g, '<br/>');
    // 處理 **重點**
    html = html.split('**').map((part, index) => 
        index % 2 === 1 
          ? `<span style="color: ${highlightColor}; font-weight: bold;">${part}</span>` 
          : `<span>${part}</span>` 
    ).join('');
    return html;
  };

  // 輔助函數：將 SVG 網址轉換為 PNG (透過 wsrv.nl)
  const convertSvgToPngUrl = (url: string) => {
    if (!url) return '';
    if (url.endsWith('.svg')) {
        // 使用 wsrv.nl 進行即時轉換，輸出為 png
        return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=png`;
    }
    return url;
  };

  const handleStart = () => {
    // 加入 try-catch 防護，防止 History API 在某些環境下報錯
    try {
        if (window.history && typeof window.history.pushState === 'function') {
            const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({path:newurl},'',newurl);
        }
    } catch (e) {
        console.warn("History API restricted in this environment, skipping URL cleanup.", e);
    }

    setStep('quiz');
    setCurrentIdx(0);
    setIsIntroMode(true);
    setAnswers({});
    setAiAnalysis(null);
    setFakeProgress(0);
    setLastError('');
    setShowKeyInput(false);
    setEmailStatus('idle'); // 重置寄送狀態
    setIsResultUnlocked(false); // 重置解鎖狀態
    aiFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
  };
  
  // ------------------------------------------------------------
  // 處理 Systeme.io 表單提交 (AJAX no-cors 模式)
  // ------------------------------------------------------------
  const handleSystemeSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // 1. 阻止表單預設的跳轉行為
    e.preventDefault();
    e.stopPropagation(); 

    const form = e.currentTarget;
    const actionUrl = form.action; 
    const formData = new FormData(form);
    const email = formData.get('email') as string;
    const name = formData.get('first_name') as string; 
    
    if (!email) return;

    setUserEmail(email);
    if (name) setUserName(name);
    
    // 解鎖結果
    setIsResultUnlocked(true);

    // 滾動到四大分析區塊
    setTimeout(() => {
        dimensionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    // 觸發 Webhook 發送完整報告
    if (aiAnalysis && localSummary) {
        sendResultsToWebhook(email, name, aiAnalysis, localSummary);
    }

    // 3. 背景發送資料到 Systeme.io
    if (actionUrl) {
        fetch(actionUrl, {
            method: 'POST',
            body: formData,
            mode: 'no-cors' 
        }).then(() => {
            console.log("Form submitted to Systeme.io via background fetch");
        }).catch((err) => {
            console.error("Systeme submission error (proceeding anyway):", err);
        });
    }
  };

  // ------------------------------------------------------------
  // Webhook 傳送功能 (標準 CORS 模式)
  // ------------------------------------------------------------
  const sendResultsToWebhook = async (email: string, name: string, report: AiReport, summaryData: any) => {
    
    if (!N8N_WEBHOOK_URL) {
        console.log("n8n Webhook URL 未設定，跳過資料傳送。");
        return;
    }

    setEmailStatus('sending');
    
    // 確保 ID 為小寫並去除空白
    const normalizedId = report.selectedPersonaId ? report.selectedPersonaId.toLowerCase().trim() : 'neighbor';
    
    // 嚴格的 Fallback：如果找不到對應 ID，強制使用 Neighbor，確保不為 undefined
    const personaData = PERSONAS.find(p => p.id === normalizedId) || PERSONAS.find(p => p.id === 'neighbor') || PERSONAS[3];

    const tagsHtml = (personaData?.tags || []).map(tag => 
        `<span style="display:inline-block; background-color:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 16px; border-radius:50px; font-size:14px; font-weight:bold; margin-right:8px; margin-bottom:8px;"># ${tag}</span>`
    ).join('');

    // 輔助函數：從 summaryData 中找特定分類的資料
    const getCatData = (catName: string) => {
        const item = summaryData.summary.find((s:any) => s.category === catName);
        let statusColor = '#ef4444'; // Red
        let statusBg = '#fef2f2';
        let statusText = '#b91c1c';
        
        if (item?.level === '綠燈') {
             statusColor = '#22c55e';
             statusBg = '#f0fdf4';
             statusText = '#15803d';
        } else if (item?.level === '黃燈') {
             statusColor = '#f97316';
             statusBg = '#fff7ed'; // Amber-50
             // [重點修正] 黃燈文字強制使用新金色 (#edae26)
             statusText = '#edae26'; 
        }

        return {
            score: item?.score || 0,
            level: item?.level || '紅燈',
            color: statusColor,
            bg_color: statusBg,
            text_color: statusText
        };
    };

    const skinData = getCatData('面容氣色');
    const hairData = getCatData('髮型駕馭');
    const styleData = getCatData('穿搭策略');
    const socialData = getCatData('社群形象');

    // --------------------------------------------------
    // 生成 QuickChart 靜態圖片 URL
    // --------------------------------------------------
    // QuickChart 預設使用 Chart.js v2.9.4，這裡配置 v2 語法
    // [重點] 使用 Title 將分數繪製在圖表上方，達成「圖片顯示分數」且「無接縫」
    const chartConfig = {
      type: 'radar',
      data: {
        labels: ['面容氣色', '髮型駕馭', '穿搭策略', '社群形象'],
        datasets: [{
          label: '形象力',
          data: [skinData.score, hairData.score, styleData.score, socialData.score],
          backgroundColor: 'rgba(59, 130, 246, 0.2)', // 藍色半透明填充
          borderColor: 'rgb(59, 130, 246)',         // 藍色邊框
          pointBackgroundColor: 'rgb(59, 130, 246)',
          borderWidth: 4 // 加粗線條
        }]
      },
      options: {
        legend: { display: false },
        title: { 
            display: true, 
            text: ['形象總分', `${summaryData.totalScore} / 60`], 
            fontSize: 45, 
            fontColor: '#2563eb', // 指定藍色
            fontStyle: 'bold',
            fontFamily: 'Noto Sans TC',
            padding: 30
        },
        layout: {
          padding: 10 
        },
        scale: {
          ticks: { display: false, max: 15, min: 0, stepSize: 5 }, 
          pointLabels: { 
              fontSize: 28, // 相對於 400px 的畫布
              fontColor: '#334155', 
              fontStyle: 'bold', 
              fontFamily: 'Noto Sans TC' 
          },
          gridLines: {
              color: '#94a3b8', 
              lineWidth: 2
          },
          angleLines: {
              color: '#94a3b8', 
              lineWidth: 2
          }
        }
      }
    };
    
    // 產生圖片 URL：
    // bkg=%23ffffff : 圖片背景保持純白是安全的
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&width=500&height=500&devicePixelRatio=2&bkg=%23ffffff`;


    // --------------------------------------------------
    // 處理 SVG 轉 PNG (確保 Email 可顯示)
    // --------------------------------------------------
    const originalPersonaImage = personaData?.imageUrl || 'https://d1yei2z3i6k35z.cloudfront.net/2452254/694c9c2d8b687_4.%E6%BA%AB%E6%9A%96%E7%9A%84%E9%84%B0%E5%AE%B6%E7%94%B7%E5%AD%A9.svg';
    const personaImagePng = convertSvgToPngUrl(originalPersonaImage);

    // 整理 payload
    const taiwanDate = new Date().toLocaleString('zh-TW', { 
      timeZone: 'Asia/Taipei', 
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    // 準備銷售文案 (網頁版 UI 對應的文字)
    const salesIntroText = `你真正需要的不是只變帥那一天的單次服務，而是擁有一套**可立即套用的形象公式**，能夠**展示自己最好的一面**。\n\n我將這七年的實戰與教學經驗，簡化為好懂、好複製的系統化SOP，\n正式名稱：「**SOLAR戀愛形象系統**」。`;

    // --------------------------------------------------
    // [重點修正] 定義顏色變數 (Hex Codes)
    // --------------------------------------------------
    const BRAND_GOLD = '#edae26'; // [修正] 統一使用 #edae26

    // --------------------------------------------------
    // 生成 HTML Components (對應 n8n Gmail Node)
    // --------------------------------------------------
    
    // 1. Dimensions Grid HTML
    const dimensionsGridHtml = `
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td width="48%" valign="top">
            <!-- Skin Card -->
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 16px; border: 1px solid #e2e8f0; border-left: 6px solid ${skinData.color}; overflow: hidden; margin-bottom: 15px;">
                <div style="padding-left: 10px;">
                    <div style="margin-bottom: 8px;">
                        <span style="font-size: 16px; font-weight: 900; color: #0f172a;">🧴 面容氣色</span>
                        <span style="float: right; font-size: 12px; font-weight: bold; background-color: ${skinData.bg_color}; color: ${skinData.text_color}; padding: 2px 8px; border-radius: 99px;">${skinData.level}</span>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">${convertToHtmlString(report.skinAnalysis, BRAND_GOLD)}</p>
                </div>
            </div>
            
            <!-- Style Card -->
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 16px; border: 1px solid #e2e8f0; border-left: 6px solid ${styleData.color}; overflow: hidden;">
                <div style="padding-left: 10px;">
                    <div style="margin-bottom: 8px;">
                        <span style="font-size: 16px; font-weight: 900; color: #0f172a;">👔 穿搭策略</span>
                        <span style="float: right; font-size: 12px; font-weight: bold; background-color: ${styleData.bg_color}; color: ${styleData.text_color}; padding: 2px 8px; border-radius: 99px;">${styleData.level}</span>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">${convertToHtmlString(report.styleAnalysis, BRAND_GOLD)}</p>
                </div>
            </div>
          </td>
          <td width="4%"></td>
          <td width="48%" valign="top">
            <!-- Hair Card -->
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 16px; border: 1px solid #e2e8f0; border-left: 6px solid ${hairData.color}; overflow: hidden; margin-bottom: 15px;">
                <div style="padding-left: 10px;">
                    <div style="margin-bottom: 8px;">
                        <span style="font-size: 16px; font-weight: 900; color: #0f172a;">💇‍♂️ 髮型駕馭</span>
                        <span style="float: right; font-size: 12px; font-weight: bold; background-color: ${hairData.bg_color}; color: ${hairData.text_color}; padding: 2px 8px; border-radius: 99px;">${hairData.level}</span>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">${convertToHtmlString(report.hairAnalysis, BRAND_GOLD)}</p>
                </div>
            </div>

            <!-- Social Card -->
            <div style="background-color: #f8fafc; padding: 15px; border-radius: 16px; border: 1px solid #e2e8f0; border-left: 6px solid ${socialData.color}; overflow: hidden;">
                <div style="padding-left: 10px;">
                    <div style="margin-bottom: 8px;">
                        <span style="font-size: 16px; font-weight: 900; color: #0f172a;">📸 社群形象</span>
                        <span style="float: right; font-size: 12px; font-weight: bold; background-color: ${socialData.bg_color}; color: ${socialData.text_color}; padding: 2px 8px; border-radius: 99px;">${socialData.level}</span>
                    </div>
                    <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">${convertToHtmlString(report.socialAnalysis, BRAND_GOLD)}</p>
                </div>
            </div>
          </td>
        </tr>
      </table>
    `;

    // 2. Coach Section HTML
    const coachSectionHtml = `
        <div style="background-color: #0f172a; border-radius: 24px; overflow: hidden; margin-top: 30px;">
            <img src="${EXPERT_CONFIG.imageUrl}" style="width: 100%; display: block;" />
            <div style="padding: 30px;">
                <h3 style="color: ${BRAND_GOLD}; font-size: 22px; font-weight: 900; margin: 0 0 20px 0;">💡 教練總結</h3>
                <div style="color: #e2e8f0; font-size: 16px; margin-bottom: 30px; line-height: 1.8;">
                    ${convertToHtmlString(report.coachGeneralAdvice, BRAND_GOLD)}
                </div>

                <!-- Separator -->
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
                    <tr>
                        <td style="border-bottom: 1px solid #334155; width: 35%;"></td>
                        <td style="text-align: center; color: ${BRAND_GOLD}; font-size: 12px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; padding: 0 10px;">YOUR NEXT STEP</td>
                        <td style="border-bottom: 1px solid #334155; width: 35%;"></td>
                    </tr>
                </table>

                <h4 style="text-align: center; color: #ffffff; font-size: 24px; font-weight: 900; margin: 0 0 20px 0;">從「知道」到「做到」</h4>
                <div style="color: #cbd5e1; font-size: 15px; text-align: justify; margin-bottom: 30px; line-height: 1.6;">
                    這份報告指出了你的盲點，但「知道」不等於「做到」。<span style="color: ${BRAND_GOLD}; font-weight: bold;">形象建立是你現在最有效的槓桿</span>，因為它能在短時間內產生明顯的視覺反饋與外界評價。只要你願意在細節上投入，你的社交機會與心理強度將會產生<span style="color: ${BRAND_GOLD}; font-weight: bold;">質的飛躍</span>。請從今天開始，把打理自己當作一場必要的戰鬥準備。
                </div>

                <!-- 3-Day Plan Card -->
                <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 25px 20px; margin-bottom: 30px;">
                    <h5 style="color: ${BRAND_GOLD}; text-align: center; font-size: 20px; font-weight: 900; margin: 0 0 20px 0;">你的「3天形象急救計畫」</h5>
                    
                    <p style="color: #ffffff; text-align: center; font-size: 15px; margin: 0 0 25px 0; line-height: 1.6;">
                        單看報告不會讓你變帥。為了幫你把這份診斷轉化為實際的吸引力，我準備了連續三天的「行動指南」寄給你：
                    </p>
                    
                    <!-- Day 1 -->
                    <div style="margin-bottom: 15px; background-color: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td width="30" valign="top" style="font-size: 20px;">🗓️</td>
                                <td style="color: #e2e8f0; font-size: 15px; line-height: 1.5; padding-left: 10px;">
                                    <span style="color: #ffffff; font-weight: bold;">明天 (Day 1)：</span>
                                    整體形象的<span style="color: ${BRAND_GOLD}; font-weight: bold;">「止損第一步」</span>
                                </td>
                            </tr>
                        </table>
                    </div>
                    
                    <!-- Day 2 -->
                    <div style="margin-bottom: 15px; background-color: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td width="30" valign="top" style="font-size: 20px;">🗓️</td>
                                <td style="color: #e2e8f0; font-size: 15px; line-height: 1.5; padding-left: 10px;">
                                    <span style="color: #ffffff; font-weight: bold;">後天 (Day 2)：</span>
                                    理工男也能懂的<span style="color: ${BRAND_GOLD}; font-weight: bold;">「萬用穿搭公式」</span>
                                </td>
                            </tr>
                        </table>
                    </div>
                    
                    <!-- Day 3 -->
                    <div style="margin-bottom: 25px; background-color: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #334155;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td width="30" valign="top" style="font-size: 20px;">🗓️</td>
                                <td style="color: #e2e8f0; font-size: 15px; line-height: 1.5; padding-left: 10px;">
                                    <span style="color: #ffffff; font-weight: bold;">最後 (Day 3)：</span>
                                    從「路人照片」變身<span style="color: ${BRAND_GOLD}; font-weight: bold;">「高配對形象」</span>
                                </td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="text-align: center; border-top: 1px solid #334155; padding-top: 20px;">
                        <p style="color: ${BRAND_GOLD}; font-size: 13px; font-weight: bold; margin: 0;">
                            ⚠️ 請留意明天晚上的信件，這是你脫單的第一步。
                        </p>
                    </div>
                </div>

                <!-- Social Media Buttons -->
                <div style="text-align: center; margin-bottom: 30px;">
                    <a href="https://lin.ee/3V3tOsx" target="_blank" style="display: inline-block; margin-bottom: 15px; text-decoration: none;">
                        <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f974627f8_69565d2473a52_6956598909c11_zh-Hant.png" style="height: 48px; width: auto; border: 0;" alt="加入 LINE 好友" />
                    </a>
                    <div style="text-align: center;">
                        <a href="https://instagram.com/freeven.coach" target="_blank" style="display: inline-block; margin: 0 10px; text-decoration: none;">
                            <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f9743b2f3_68bcafb31135a_ig.png" style="width: 40px; height: 40px; border: 0;" alt="Instagram" />
                        </a>
                        <a href="https://www.threads.net/@freeven.coach" target="_blank" style="display: inline-block; margin: 0 10px; text-decoration: none;">
                            <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f97461c7f_695f34230d336_695f20025eaf2_icon2.png" style="width: 40px; height: 40px; border: 0;" alt="Threads" />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 準備要送出的資料，預先轉好 HTML 格式
    const payload = {
        submittedAt: new Date().toISOString(), // n8n GSheet 欄位: 提交時間
        quiz_source: 'style-quiz', // n8n 欄位: quiz_source
        name: name || '你', // n8n 欄位: 姓名
        email: email, // n8n 欄位: Email
        total_score: summaryData.totalScore, // n8n 欄位: 總分
        
        quiz_result: {
            total_score: summaryData.totalScore,
            persona_id: normalizedId,
            persona_title: personaData?.title || '風格路人甲', // n8n 欄位: 人格原型, persona_type
            persona_subtitle: personaData?.subtitle || '潛力無限',
            persona_image_png: personaImagePng,
            chart_image_url: chartUrl,
            tags_html: tagsHtml,
            scores: {
                skin: skinData, 
                hair: hairData,
                style: styleData,
                social: socialData,
            }
        },
        
        // n8n 欄位映射:
        // advice_appearance -> 面容氣色
        // advice_social -> 髮型駕馭
        // advice_action -> 穿搭策略
        // advice_mindset -> 社群形象
        // coach_summary -> AI完整建議
        ai_analysis: {
            overview: convertToHtmlString(report.personaOverview || personaData.subtitle, BRAND_GOLD),
            explanation: convertToHtmlString(report.personaExplanation, BRAND_GOLD), 
            
            // Mapping to n8n expected keys
            advice_appearance: convertToHtmlString(report.skinAnalysis, BRAND_GOLD), 
            advice_social: convertToHtmlString(report.hairAnalysis, BRAND_GOLD), 
            advice_action: convertToHtmlString(report.styleAnalysis, BRAND_GOLD), 
            advice_mindset: convertToHtmlString(report.socialAnalysis, BRAND_GOLD), 
            
            coach_summary: convertToHtmlString(report.coachGeneralAdvice, BRAND_GOLD) 
        },
        
        // HTML Components for Gmail
        html_components: {
            dimensions_grid: dimensionsGridHtml,
            coach_section: coachSectionHtml
        },

        sales_copy: {
            expert_image: EXPERT_CONFIG.imageUrl,
            sales_intro_html: convertToHtmlString(salesIntroText, BRAND_GOLD), 
            expert_desc_html: convertToHtmlString(EXPERT_CONFIG.description, BRAND_GOLD) 
        }
    };
    
    console.log("🚀 [Webhook Payload] 即將發送的資料:", JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(payload),
            mode: 'cors',
            credentials: 'omit' 
        });

        if (response.ok) {
            console.log("✅ 測驗結果傳送成功 (Status 200/201)");
            setEmailStatus('success');
        } else {
            console.error(`❌ Webhook 伺服器回傳錯誤: ${response.status} ${response.statusText}`);
            setEmailStatus('error');
        }

    } catch (error) {
      console.error("❌ Webhook 傳送失敗 (可能是 CORS 阻擋):", error);
      setEmailStatus('error');
    }
  };

  useEffect(() => {
    let timer: number;
    if (step === 'diagnosing' && !lastError) {
      setFakeProgress(1);
      timer = window.setInterval(() => {
        setFakeProgress(prev => {
          if (prev >= 98) return prev;
          return prev + 0.8; 
        });
      }, 100);
    }
    return () => clearInterval(timer);
  }, [step, lastError]);

  const localSummary = useMemo(() => {
    if (step !== 'result' && step !== 'diagnosing') return null;
    const categories: Category[] = ['面容氣色', '髮型駕馭', '穿搭策略', '社群形象'];
    const summary = categories.map(cat => {
      const catQuestions = QUESTIONS.filter(q => q.category === cat);
      const score = catQuestions.reduce((acc, q) => {
          const val = answers[q.id];
          return acc + (val === -1 ? 0 : (val || 0));
      }, 0);
      
      let level: '紅燈' | '黃燈' | '綠燈' = '紅燈';
      let color = '#ef4444'; 
      if (score >= 12) { level = '綠燈'; color = '#22c55e'; }
      else if (score >= 7) { level = '黃燈'; color = '#f97316'; }
      return { category: cat, score, level, color, description: CATEGORY_INFO[cat].description, suggestion: CATEGORY_INFO[cat].suggestions[level] };
    });

    const totalScore = summary.reduce((acc, curr) => acc + curr.score, 0);
    return { summary, totalScore };
  }, [step, answers]);

  // 當結果出爐時，切換步驟
  useEffect(() => {
    if (step === 'diagnosing' && aiAnalysis) {
      setFakeProgress(100);
      const timer = setTimeout(() => {
        setStep('result');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // 移除自動發送 Webhook，改為在表單提交後觸發
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [step, aiAnalysis]);

  // 獨立出的分析函數
  const runDiagnosis = async (forceFallback: boolean = false, overrideKey: string = '') => {
    if (!localSummary) return;
    
    const now = Date.now();
    if (aiFetchingRef.current && !forceFallback && !overrideKey) return;
    
    if (!forceFallback && !overrideKey && now - lastFetchTimeRef.current < 2000) {
        console.log("Request blocked by debounce");
        return;
    }

    aiFetchingRef.current = true;
    lastFetchTimeRef.current = now;
    setIsAiLoading(true);
    setLastError('');
    setShowKeyInput(false);

    // 簡單的 Fallback 邏輯 (無 AI 時)
    let fallbackId = 'neighbor';
    if (localSummary.totalScore >= 48) fallbackId = 'charmer';
    else if (localSummary.totalScore >= 38) fallbackId = 'statue'; // 分數還行但沒頂尖 -> 半成品
    else if (localSummary.totalScore <= 20) fallbackId = 'pioneer'; // 分數偏低 -> 重塑者
    // 中間分數段 (21-37) 預設為路人甲

    // 備用資料 (Fallback)
    const fallbackAnalysis: AiReport = {
      selectedPersonaId: fallbackId,
      personaExplanation: forceFallback 
        ? "⚠️ 這是「基礎分析模式」的報告。因目前 AI 連線異常，系統直接根據您的分數區間進行診斷。" 
        : "⚠️ AI 連線忙碌中，這是根據您的分數生成的基礎報告。",
      personaOverview: "您的潛力巨大，建議重新整理頁面再次進行深度分析。",
      skinAnalysis: "保養是基本功，請建立每日SOP。",
      hairAnalysis: "髮型決定第一印象，請尋找合適設計師。",
      styleAnalysis: "穿搭需要策略，請注重版型與修飾。",
      socialAnalysis: "經營社群就是經營個人品牌。",
      coachGeneralAdvice: "這是一份基礎戰略報告。請參考上方的雷達圖與維度分析，這依然是你提升魅力的重要起點。若需 **完整的 AI 深度解析**，建議稍後再試。"
    };

    if (forceFallback) {
        setTimeout(() => {
            setAiAnalysis(fallbackAnalysis);
            setIsAiLoading(false);
            aiFetchingRef.current = false;
        }, 800);
        return;
    }

    // 嘗試多種來源取得 API Key (支援 Vercel 環境變數與 Vite 標準變數)
    const apiKeyToUse = overrideKey || customApiKey || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKeyToUse) {
      console.error("API Key is missing.");
      setLastError("系統設定：未偵測到 API Key (請檢查 Vercel 環境變數是否勾選 Preview/Production)");
      setShowKeyInput(true);
      setIsAiLoading(false);
      aiFetchingRef.current = false;
      return;
    }

    try {
      console.log("Initializing Google GenAI...");
      const ai = new GoogleGenAI({ apiKey: apiKeyToUse });
      
      const detailedData = QUESTIONS.map(q => ({
        category: q.category,
        question: q.text,
        answer: OPTIONS.find(o => o.value === answers[q.id])?.label || '未答'
      }));

      const prompt = `
        你現在是專業男性形象教練「彭邦典」。這是一位 25-35 歲男性的「形象力檢測」測驗結果報告。
        
        數據：
        1. 總分：${localSummary.totalScore}/60 (共4類，每類15分)
        2. 各維度分數：${JSON.stringify(localSummary.summary.map(s => ({ cat: s.category, score: s.score, level: s.level })))}
        3. 具體作答：${JSON.stringify(detailedData)}
        4. 使用者姓名：${userName || '你'}

        任務指令：
        請根據「詳細作答內容」與「分數分佈」，判定他最符合哪一個人格原型。請嚴格遵守下方的判定矩陣，避免過度將人歸類為路人甲。

        **人格判定邏輯矩陣 (請優先判斷)：**

        1. **理論派觀察家 (sage)** [高優先判斷]：
           - 特徵：**知行不合一**。
           - 判斷依據：請檢查他的作答。若他在「知識型/觀念型」題目（關鍵字：我知道、我清楚、我了解）選「非常符合/有點符合」，但在「實作型/習慣型」題目（關鍵字：我有固定、我會定期、重現造型）選「不太符合/完全沒有」。這代表他懂理論但沒做到。

        2. **半成品帥哥 (statue)**：
           - 特徵：**遠看可以，近看破功**。
           - 判斷依據：「穿搭策略」或「髮型駕馭」分數較高（綠燈或高標黃燈），但「面容氣色」分數偏低（紅燈）。代表他會打扮，但皮膚細節或眉毛雜毛沒處理好。

        3. **風格迷航者 (hustler)**：
           - 特徵：**用力過猛**。
           - 判斷依據：「穿搭策略」得分不低，但可能在「風格系統」或「購物邏輯」題選了低分；或者總分中等，但社群形象分數極低（代表審美未具象化）。

        4. **全方位質感男神 (charmer)**：
           - 判斷依據：總分 > 48，且四大維度皆無紅燈。作答幾乎都是「非常符合」。

        5. **形象重塑者 (pioneer)**：
           - 判斷依據：總分 < 24，或四大維度中有 3 個以上是紅燈。代表各方面都還是一張白紙。

        6. **乾淨的路人甲 (neighbor)** [預設值]：
           - 判斷依據：若 **不符合** 上述任何特徵。各維度分數非常平均，沒有特別的高分項，也沒有致命低分，作答大多落在「有點符合」或「不太符合」的中間地帶。

        ---
        
        **寫作風格重點 (重要)：**
        請使用 \`**重點文字**\` 來標記關鍵建議，系統會自動高亮。
        
        **語氣調整：**
        請扮演一位「溫暖、堅定且值得信賴的導師」。
        請在分析與建議中，使用自然、流暢的第二人稱（你）來對話，不需要刻意填入名字，重點是讓對方感受到被理解與支持。
        1. **收斂攻擊性**：請絕對避免使用帶有嘲諷、羞辱感或過度嚴厲的譬喻（例如：不要說「難以下嚥」、「只模仿皮毛」這類讓人感到挫折的話）。
        2. **建設性視角**：請以「我看見了你的潛力，但可惜目前被 [問題點] 阻擋了光芒」的角度切入。一針見血是指「精準指出問題核心」，而不是「刺傷自尊」。
        3. **溫暖的專業**：請用正面、肯定的詞彙來包裹你的建議。告訴他，他現在的困境很正常，而你有一套方法可以帶他走出來。
        
        JSON 結構範本：
        {
          "selectedPersonaId": "從 [charmer, statue, hustler, neighbor, sage, pioneer] 中選一個最貼切的 ID",
          "personaExplanation": "深度分析為什麼他符合這個人格原型，請引用他的具體作答來佐證 (約 150 字)",
          "personaOverview": "一句話總結他的現狀",
          "skinAnalysis": "針對『面容氣色』的具體分析建議 (約 50 字)",
          "hairAnalysis": "針對『髮型駕馭』的具體分析建議 (約 50 字)",
          "styleAnalysis": "針對『穿搭策略』的具體分析建議 (約 50 字)",
          "socialAnalysis": "針對『社群形象』的具體分析建議 (約 50 字)",
          "coachGeneralAdvice": "教練的總結戰略建議 (約 200 字)。**請務必分成 2-3 個段落撰寫，不要寫成一大塊文字**，段落間請留空行，讓閱讀更輕鬆。**結尾必須嚴格包含此句**：「一定要記得，知道問題不等於能解決問題，形象的改造涉及到對自我的認識與系統化的打扮邏輯，若無系統性訓練很容易走彎路、花冤枉錢，你需要查看下方的『**3天形象急救計畫**』，讓我陪你把這塊原石磨出光彩。」"
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");

      const parsedData = JSON.parse(text) as AiReport;
      setAiAnalysis(parsedData);

    } catch (e: any) {
      console.error("AI Analysis Error:", e);
      let errorMsg = "連線忙碌中";
      const errString = e.toString();
      if (errString.includes("400") && errString.includes("API key")) {
          errorMsg = "⚠️ API Key 無效";
          setShowKeyInput(true);
      } else if (errString.includes("429")) {
          errorMsg = "⚠️ 請求次數過多";
          setShowKeyInput(true);
      } else {
          errorMsg = `⚠️ 發生錯誤: ${errString.slice(0, 30)}...`;
      }
      setLastError(errorMsg);
      aiFetchingRef.current = false;
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    if (step === 'diagnosing' && localSummary && !aiFetchingRef.current && !lastError && !aiAnalysis && !showKeyInput) {
        runDiagnosis(false);
    }
  }, [step, localSummary]);

  useEffect(() => {
    if (step === 'result' && localSummary && radarChartRef.current) {
      const ctx = radarChartRef.current.getContext('2d');
      const isMobile = window.innerWidth < 768;
      const labelFontSize = isMobile ? 16 : 20;
      const titleFontSize = isMobile ? 24 : 32;

      if (ctx) {
        if (chartInstance.current) chartInstance.current.destroy();
        // @ts-ignore
        chartInstance.current = new Chart(ctx, {
          type: 'radar',
          data: {
            labels: localSummary.summary.map(r => r.category),
            datasets: [{
              label: '形象力',
              data: localSummary.summary.map(r => r.score),
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderColor: 'rgba(59, 130, 246, 1)',
              borderWidth: 3,
              pointBackgroundColor: 'rgba(59, 130, 246, 1)',
              pointBorderColor: '#fff',
            }]
          },
          options: {
            scales: { 
              r: { 
                min: 0, max: 15, ticks: { display: false, stepSize: 5 }, // 滿分改為 15
                pointLabels: { 
                    font: { size: labelFontSize, weight: 'bold', family: "'Noto Sans TC', sans-serif" }, 
                    color: '#334155' 
                }
              } 
            },
            plugins: { 
                legend: { display: false },
                // [網頁端 Chart.js v4] 設定標題，使其與 Email 圖片一致
                title: {
                    display: true,
                    text: ['形象總分', `${localSummary.totalScore} / 60`],
                    color: '#2563eb', // 指定藍色
                    font: { size: titleFontSize, weight: 'bold', family: "'Noto Sans TC', sans-serif" },
                    padding: { top: 10, bottom: 20 }
                }
            },
            maintainAspectRatio: false
          }
        });
      }
    }
  }, [step, localSummary]);

  const handleAnswer = (val: number) => {
    setAnswers(prev => ({ ...prev, [QUESTIONS[currentIdx].id]: val }));
    setTimeout(() => {
        nextStep();
    }, 250); 
  };
  
  const nextStep = () => {
    if (isIntroMode) { setIsIntroMode(false); return; }
    if (currentIdx < QUESTIONS.length - 1) {
      const nextIdx = currentIdx + 1;
      // 改為每 5 題顯示一次 Intro (對應 4 大分類)
      if (nextIdx % 5 === 0) setIsIntroMode(true);
      setCurrentIdx(nextIdx);
    } else {
      setStep('diagnosing');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const prevStep = () => {
    if (isIntroMode) {
      if (currentIdx > 0) { 
        setIsIntroMode(false); 
        setCurrentIdx(currentIdx - 1); 
      } else {
        setStep('hero');
      }
      return;
    }
    // 改為每 5 題判斷
    if (currentIdx % 5 === 0) setIsIntroMode(true);
    else setCurrentIdx(prev => prev - 1);
  };

  const activePersona = useMemo(() => {
    if (!aiAnalysis) return PERSONAS[5];
    const normalizedId = aiAnalysis.selectedPersonaId.toLowerCase().trim();
    const found = PERSONAS.find(p => p.id === normalizedId);
    return found || PERSONAS[5];
  }, [aiAnalysis]);

  const getAiAnalysisForCategory = (category: Category) => {
    if (!aiAnalysis) return "分析中...";
    switch(category) {
      case '面容氣色': return aiAnalysis.skinAnalysis;
      case '髮型駕馭': return aiAnalysis.hairAnalysis;
      case '穿搭策略': return aiAnalysis.styleAnalysis;
      case '社群形象': return aiAnalysis.socialAnalysis;
      default: return "";
    }
  };

  return (
    <div className="min-h-screen max-w-2xl mx-auto flex flex-col items-center px-0 md:px-8 py-0 md:py-8">
      {step === 'hero' && (
        <div className="flex-1 flex flex-col justify-start md:justify-center w-full animate-fade-in py-6 md:py-10 space-y-4 md:space-y-12 px-4 md:px-0">
          <div className="text-center space-y-2 md:space-y-4 relative z-20">
            <h1 className="text-3xl md:text-7xl font-black text-slate-900 tracking-tighter leading-normal py-1">形象力檢核分析</h1>
            <div className="space-y-1 md:space-y-2">
                <p className="text-lg md:text-3xl text-slate-500 font-bold">專為 25-35 歲男性設計</p>
                <p className="text-lg md:text-3xl text-slate-500 font-bold">找出阻礙你散發魅力的形象盲點</p>
            </div>
          </div>

          <div className="relative w-full aspect-[16/9] flex items-center justify-center animate-float overflow-visible">
             <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6950e2a881260_1.911.png" className="object-contain w-full h-full drop-shadow-2xl" />
          </div>

          <div className="px-2 md:px-4 w-full relative z-20 flex justify-center">
             <button 
               onClick={handleStart}
               className="w-full max-w-md relative overflow-hidden bg-slate-900 hover:bg-black text-white font-black py-5 md:py-6 rounded-[2rem] text-2xl md:text-3xl shadow-2xl transition transform active:scale-95 text-center group animate-shimmer"
             >
               <span className="relative z-10">立即開始檢測</span>
             </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:gap-6 px-2 md:px-4">
            {[
              { icon: '✨', title: '魅力原型', desc: '找出你的原生氣質定位', color: 'rgba(244, 63, 94, 0.4)' },
              { icon: '📐', title: '四維分析', desc: '膚況/髮型/穿搭/社群', color: 'rgba(59, 130, 246, 0.4)' },
              { icon: '🕴️', title: '教練建議', desc: '獲得個人的變身戰略', color: 'rgba(16, 185, 129, 0.4)' }
            ].map((feature, i) => (
              // 更新：背景改為 #ffffff，邊框改為 border-slate-100
              <div key={i} className="flex items-center space-x-4 md:space-x-6 bg-[#ffffff] p-5 md:p-6 rounded-[2rem] md:rounded-[2.5rem] shadow-sm border border-slate-100 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 group cursor-default">
                <div className="text-4xl md:text-6xl transition-transform duration-300 group-hover:scale-110" style={{ filter: `drop-shadow(0 4px 6px ${feature.color})` }}>{feature.icon}</div>
                <div>
                  <h3 className="text-xl md:text-2xl font-black text-slate-800">{feature.title}</h3>
                  <p className="text-sm md:text-lg text-slate-400 font-medium">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'quiz' && (
        <div className="w-full space-y-4 md:space-y-6 py-6 md:py-4 px-4 md:px-0">
          <div className="w-full px-2">
            <div className="flex justify-between text-sm text-slate-400 mb-2 font-black uppercase tracking-widest">
              <span>{QUESTIONS[currentIdx].category}</span>
              <span>Question {currentIdx + 1} / {QUESTIONS.length}</span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all duration-500 ease-out" style={{ width: `${((currentIdx + (isIntroMode ? 0 : 1)) / QUESTIONS.length) * 100}%` }}></div>
            </div>
          </div>

          <div key={isIntroMode ? `intro-${currentIdx}` : `q-${currentIdx}`} className="animate-slide-up">
            {isIntroMode ? (
              // 更新：背景改為 #ffffff，邊框改為 border-slate-100
              <div className="bg-[#ffffff] p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-slate-100 text-center flex flex-col items-center">
                <div className="mb-4 md:mb-6 text-5xl md:text-7xl animate-bounce">
                  {/* 圖標映射更新：面容氣色使用 🧴 (Lotion) 替代原本的 ✨ */}
                  {currentIdx === 0 ? '🧴' : currentIdx === 5 ? '💇‍♂️' : currentIdx === 10 ? '👔' : '📸'}
                </div>
                <h2 className="text-3xl md:text-5xl font-black text-slate-800 mb-2 md:mb-4">{QUESTIONS[currentIdx].category}</h2>
                <p className="text-lg md:text-2xl text-slate-500 leading-relaxed mb-6 md:mb-10">{CATEGORY_INFO[QUESTIONS[currentIdx].category].description}</p>
                <div className="w-full space-y-3 md:space-y-4">
                  <button onClick={nextStep} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 md:py-6 rounded-2xl text-xl md:text-2xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-95">進入測驗</button>
                  <button onClick={prevStep} className="w-full py-2 md:py-4 text-base md:text-lg text-slate-400 font-bold hover:text-slate-600 transition-colors">回到上一題</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 md:space-y-6">
                {/* 更新：背景改為 #ffffff，邊框改為 border-slate-100 */}
                <div className="bg-[#ffffff] p-5 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-xl border border-slate-100 min-h-[160px] md:min-h-[200px] flex items-center justify-center">
                  <h2 className="text-xl md:text-3xl font-black text-slate-800 text-center leading-relaxed px-1 md:px-4">{QUESTIONS[currentIdx].text}</h2>
                </div>
                
                <div className="space-y-2.5 md:space-y-3">
                  {OPTIONS.map((opt, idx) => {
                    const isSelected = answers[QUESTIONS[currentIdx].id] === opt.value;
                    return (
                      <button 
                        key={opt.value} 
                        onClick={() => handleAnswer(opt.value)} 
                        // 更新：未選取狀態背景改為 #ffffff
                        className={`group w-full p-3.5 md:p-6 rounded-2xl border-2 transition-all duration-200 flex items-center justify-between animate-pop-in
                          ${isSelected 
                            ? 'border-blue-600 bg-blue-50 shadow-md scale-[0.98]' 
                            : 'border-slate-100 bg-[#ffffff] hover:border-blue-200 hover:bg-slate-50 hover:-translate-y-1 hover:shadow-md'
                          }
                        `}
                        style={{ animationDelay: `${idx * 70}ms` }}
                      >
                        <span className={`font-bold text-lg md:text-2xl transition-colors ${isSelected ? 'text-blue-700' : 'text-slate-700 group-hover:text-blue-600'}`}>
                          {opt.label}
                        </span>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300
                           ${isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-200 group-hover:border-blue-400'}
                        `}>
                          <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-0'}`}></div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center px-2 pt-2 md:pt-4">
                  <button onClick={prevStep} className="w-full py-3 md:py-4 rounded-2xl font-bold text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">回到上一題</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'diagnosing' && (
        <div className="flex-1 flex flex-col items-center justify-center w-full min-h-[60vh] space-y-12 animate-fade-in text-center px-6 md:px-0">
          {!lastError ? (
            <>
              <div className="relative">
                <div className="w-32 h-32 border-8 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center text-3xl font-black text-slate-800">{Math.floor(fakeProgress)}%</div>
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-slate-900 tracking-tight">形象診斷中...</h2>
                <div className="flex flex-col space-y-2 text-xl text-slate-500 font-bold">
                  <span className={`transition-all duration-500 ${fakeProgress > 15 ? 'text-blue-600 translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>● 正在分析膚質與氣色數據...</span>
                  <span className={`transition-all duration-500 ${fakeProgress > 45 ? 'text-blue-600 translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>● 比對 髮型與臉型邏輯...</span>
                  <span className={`transition-all duration-500 ${fakeProgress > 80 ? 'text-blue-600 translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>● 正在生成專屬變身建議...</span>
                </div>
              </div>
              <div className="w-full bg-slate-100 h-4 rounded-full overflow-hidden shadow-inner">
                <div className="h-full bg-blue-600 transition-all duration-300 ease-out" style={{ width: `${fakeProgress}%` }}></div>
              </div>
              
              {/* Loading Tips */}
              <div className="h-20 flex items-center justify-center px-4">
                  <p className={`text-lg md:text-xl text-slate-600 font-bold transition-opacity duration-500 ${showTip ? 'opacity-100' : 'opacity-0'}`}>
                      {LOADING_TIPS[currentTipIndex]}
                  </p>
              </div>
            </>
          ) : (
            // 更新：背景改為 #ffffff，邊框改為 border-slate-100
            <div className="space-y-6 bg-[#ffffff] p-8 rounded-[2.5rem] shadow-xl border-2 border-slate-100 max-w-md w-full animate-fade-in">
                <div className="text-6xl animate-bounce">🔐</div>
                <div className="space-y-2">
                    <h3 className="text-2xl font-black text-slate-800">
                      {showKeyInput ? "系統設定未完成" : "連線發生問題"}
                    </h3>
                    <p className="text-slate-500 font-medium text-lg">
                        {showKeyInput 
                          ? "此網站尚未配置 Gemini API Key。" 
                          : lastError}
                    </p>
                </div>
                {showKeyInput ? (
                   <div className="space-y-4 pt-4">
                       <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left space-y-2">
                          <p className="text-sm font-bold text-slate-700">【臨時測試通道】</p>
                          <input 
                            type="text" 
                            value={customApiKey}
                            onChange={(e) => setCustomApiKey(e.target.value)}
                            placeholder="貼上您的 Gemini API Key (AIza...)"
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                          />
                       </div>
                       <button 
                         onClick={() => runDiagnosis(false)} 
                         disabled={!customApiKey}
                         className={`w-full py-4 rounded-2xl font-bold transition-colors shadow-lg
                           ${customApiKey 
                             ? 'bg-blue-600 text-white hover:bg-blue-700' 
                             : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                           }`}
                       >
                           確認並開始分析
                       </button>
                   </div>
                ) : (
                   <button onClick={() => runDiagnosis(false)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black transition-colors shadow-lg shadow-slate-200">
                       重試連線
                   </button>
                )}
                <button onClick={() => runDiagnosis(true)} className="w-full py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-bold hover:bg-slate-50 transition-colors">
                    跳過 AI，直接查看基礎報告
                </button>
            </div>
          )}
          <p className="text-slate-400 font-medium italic">「變帥不是靠運氣，而是靠科學」</p>
        </div>
      )}

      {step === 'result' && localSummary && aiAnalysis && (
        <div className="w-full space-y-10 animate-fade-in pb-12 bg-white px-2 py-4">
          {/* Persona Card: #ffffff 背景，邊框改為 border-slate-100 */}
          <div className="bg-[#ffffff] rounded-b-[2.5rem] md:rounded-[3.5rem] shadow-2xl overflow-hidden border-b md:border border-slate-100 animate-slide-up" style={{ animationDelay: '0ms' }}>
            <div className="relative aspect-[3/4] md:aspect-[21/9] flex items-end justify-center bg-gray-900">
              <img src={activePersona.imageUrl} alt={activePersona.title} className="w-full h-full object-cover object-top" />
              <div className="absolute bottom-0 left-0 p-6 md:p-10 text-white bg-gradient-to-t from-black/90 via-black/50 to-transparent w-full pt-24 md:pt-32">
                <div className="flex flex-col items-start space-y-1 mb-2">
                   <div className="flex flex-wrap items-center gap-2">
                       <span className="bg-blue-600 text-white text-[10px] md:text-xs font-bold px-2 md:px-3 py-1 rounded-full uppercase tracking-wider">Persona</span>
                       
                       {/* Email 傳送狀態顯示 */}
                       {userEmail && (
                           <>
                               <span className={`text-[10px] md:text-xs font-bold px-2 md:px-3 py-1 rounded-full uppercase tracking-wider transition-all duration-500 flex items-center
                                 ${emailStatus === 'success' ? 'bg-green-500 text-white' : 
                                   emailStatus === 'sending' ? 'bg-amber-400 text-slate-900 animate-pulse' : 
                                   emailStatus === 'error' ? 'bg-red-500 text-white' :
                                   'bg-white/20 text-white/70'}
                               `}>
                                   {emailStatus === 'success' && '✅ 報告已寄出'}
                                   {emailStatus === 'sending' && '⏳ 正在同步報告...'}
                                   {emailStatus === 'error' && '❌ 寄送失敗'}
                               </span>

                               {emailStatus === 'error' && aiAnalysis && localSummary && (
                                   <button 
                                     onClick={() => sendResultsToWebhook(userEmail, userName, aiAnalysis, localSummary)}
                                     className="bg-white/20 hover:bg-white/30 active:scale-95 text-white text-[10px] md:text-xs font-bold px-3 py-1 rounded-full transition-all flex items-center gap-1 backdrop-blur-md border border-white/30 shadow-sm cursor-pointer"
                                   >
                                     ↻ 重新寄送
                                   </button>
                               )}
                           </>
                       )}
                   </div>
                </div>
                <h2 className="text-3xl md:text-6xl font-black tracking-tight mb-2 leading-tight">{activePersona.title}</h2>
                <p className="text-lg md:text-3xl font-medium text-white/90 italic leading-snug">
                  {/* [修正] Hero 區塊高亮改為新金色 (#edae26) */}
                  {renderFormattedText(aiAnalysis.personaOverview || activePersona.subtitle, 'text-[#edae26]')}
                </p>
              </div>
            </div>
            <div className="p-8 md:p-10 space-y-8">
              <div className="flex flex-wrap gap-3">
                {activePersona.tags.map((tag, i) => (
                  <span key={tag} className="px-6 py-3 bg-slate-100 text-slate-800 rounded-full text-xl font-black border border-slate-200 animate-pop-in" style={{ animationDelay: `${i * 100 + 300}ms` }}># {tag}</span>
                ))}
              </div>
              
              {/* 人格診斷報告區塊：總是顯示完整內容 */}
              <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                 <h5 className="text-[#edae26] font-black text-2xl uppercase tracking-widest mb-3">人格診斷報告</h5>
                 <div className="space-y-6">
                    {aiAnalysis.personaExplanation.split('\n').filter(line => line.trim() !== '').map((line, idx) => (
                        <p key={idx} className="text-slate-800 text-lg md:text-xl leading-relaxed font-bold">
                            {renderFormattedText(line, 'text-[#edae26]')}
                        </p>
                    ))}
                 </div>
              </div>
            </div>
          </div>

          <div className="px-4 md:px-0 space-y-10">
            {/* Radar Chart Card: #ffffff 背景，邊框改為 border-slate-100 */}
            <div className="bg-[#ffffff] rounded-[3rem] shadow-xl border border-slate-100 text-center animate-slide-up overflow-hidden pb-6 md:pb-10" style={{ animationDelay: '200ms' }}>
                <div className="h-[25rem] md:h-[30rem] w-full"><canvas ref={radarChartRef}></canvas></div>
            </div>

            <div className="grid grid-cols-1 gap-6" ref={dimensionsRef}>
                <div className="text-center py-4 animate-slide-up" style={{ animationDelay: '300ms' }}>
                    <h3 className="text-3xl font-black text-slate-900 tracking-tighter">四大形象支柱深度剖析</h3>
                    <p className="text-xl text-slate-400 font-bold"> 針對你的回答細節產生的專屬建議</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {localSummary.summary.map((item, idx) => (
                    // Dimension Card: #ffffff 背景，邊框改為 border-slate-100
                    <div key={item.category} className="bg-[#ffffff] p-6 md:p-8 rounded-[2.5rem] shadow-lg border border-slate-100 flex flex-col space-y-4 relative overflow-hidden group hover:shadow-xl transition-all animate-slide-up" style={{ animationDelay: `${idx * 100 + 400}ms` }}>
                        <div className={`absolute top-0 left-0 w-2 h-full ${item.level === '綠燈' ? 'bg-green-500' : item.level === '黃燈' ? 'bg-orange-400' : 'bg-red-500'}`}></div>
                        <div className="flex items-center justify-between pl-4">
                            <h4 className="text-2xl font-black text-slate-800">{item.category}</h4>
                            <span className={`px-4 py-1.5 rounded-full text-base font-black ${
                                item.level === '綠燈' ? 'bg-green-100 text-green-700' : 
                                item.level === '黃燈' ? 'bg-[#fff7ed] text-[#edae26]' : // [修正] 黃燈背景為淺琥珀，文字為新金色
                                'bg-red-100 text-red-700'
                            }`}>
                            {item.level} ({item.score}分)
                            </span>
                        </div>
                        
                        {/* 內容區域：根據解鎖狀態顯示 */}
                        {isResultUnlocked ? (
                            <p className="text-lg md:text-xl text-slate-900 leading-relaxed pl-4 text-justify font-medium">
                                {renderFormattedText(getAiAnalysisForCategory(item.category), 'text-[#edae26]')}
                            </p>
                        ) : (
                            <div className="pl-4 relative overflow-hidden">
                                <p className="text-lg md:text-xl text-slate-300 leading-relaxed text-justify font-medium blur-sm select-none">
                                    {getAiAnalysisForCategory(item.category).slice(0, 30)}...
                                    這是一段隱藏的建議文字，解鎖後可見。針對您的回答，我們提供了具體的改善方向與執行步驟。
                                    這是一段隱藏的建議文字，解鎖後可見。針對您的回答，我們提供了具體的改善方向與執行步驟。
                                </p>
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-[2px]">
                                    <span className="text-2xl mb-1">🔒</span>
                                    <span className="text-slate-600 font-bold text-sm bg-white/80 px-3 py-1 rounded-full shadow-sm">請往下滑動解鎖</span>
                                </div>
                            </div>
                        )}
                    </div>
                    ))}
                </div>
            </div>

            {/* Coach Summary & Expert Card */}
            {activePersona.id === 'charmer' && isResultUnlocked ? (
                <div className="bg-gradient-to-br from-slate-900 to-black rounded-[3.5rem] shadow-2xl p-10 md:p-14 text-center space-y-8 animate-fade-in border border-slate-800">
                    <div className="text-6xl md:text-8xl">🏆</div>
                    <h4 className="text-3xl md:text-4xl font-black text-white">你已是頂級魅力家</h4>
                    <p className="text-slate-300 text-xl md:text-2xl font-bold">教練對你唯一的建議是：好好善用這份天賦。祝你一帆風順！</p>
                </div>
            ) : (
                // Expert Card (Container): [恢復深色主題] bg-slate-900, border-slate-800
                <div className="rounded-[3.5rem] shadow-2xl overflow-hidden border border-slate-800 flex flex-col bg-slate-900 animate-slide-up" style={{ animationDelay: '600ms' }}>
                    <div className="w-full relative">
                        <img src={EXPERT_CONFIG.imageUrl} alt="Expert Coach" className="w-full h-auto block object-cover" />
                    </div>
                    {/* 背景改為 bg-slate-900，文字改為白色/淺灰 */}
                    <div className="bg-slate-900 p-8 md:p-12 space-y-8 flex-1 relative">
                        <div className="space-y-6">
                            <div className="flex items-center space-x-3">
                                <span className="text-3xl">💡</span>
                                <h3 className="text-3xl font-black text-[#edae26] tracking-tight">教練總結</h3>
                            </div>
                            
                            {isResultUnlocked ? (
                                // 解鎖狀態：顯示完整內容
                                <div className="space-y-6 md:space-y-8">
                                    {aiAnalysis.coachGeneralAdvice.split('\n').filter(line => line.trim() !== '').map((line, idx) => (
                                    <p key={idx} className="text-xl md:text-2xl leading-loose font-bold text-slate-300 text-justify tracking-wide">
                                        {renderFormattedText(line, 'text-[#edae26]')}
                                    </p>
                                    ))}
                                </div>
                            ) : (
                                // 未解鎖狀態：顯示前1段 + 模糊遮罩 + 表單
                                <div className="relative">
                                    <div className="space-y-6 md:space-y-8 select-none">
                                        {/* 1. 清晰顯示前 1 段 */}
                                        {aiAnalysis.coachGeneralAdvice.split('\n').filter(line => line.trim() !== '').slice(0, 1).map((line, idx) => (
                                        <p key={idx} className="text-xl md:text-2xl leading-loose font-bold text-slate-300 text-justify tracking-wide">
                                            {renderFormattedText(line, 'text-[#edae26]')}
                                        </p>
                                        ))}
                                        
                                        {/* 2. 後續內容模糊處理 */}
                                        <div className="opacity-40 blur-[4px]">
                                            {aiAnalysis.coachGeneralAdvice.split('\n').filter(line => line.trim() !== '').slice(1, 4).map((line, idx) => (
                                            <p key={idx} className="text-xl md:text-2xl leading-loose font-bold text-slate-300 text-justify tracking-wide">
                                                {renderFormattedText(line, 'text-[#edae26]')}
                                            </p>
                                            ))}
                                            <p className="text-xl md:text-2xl leading-loose font-bold text-slate-300 text-justify tracking-wide">
                                                這是一段隱藏的建議文字，包含具體的行動建議與執行步驟。解鎖後即可查看完整的教練分析報告。
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* 解鎖表單卡片 - 使用漸層背景遮擋 */}
                                    <div className="absolute inset-0 z-10 flex items-end justify-center pb-4 md:pb-8 bg-gradient-to-b from-transparent via-slate-900/40 to-slate-900/90">
                                        <div className="bg-white rounded-[2rem] p-6 md:p-8 shadow-2xl max-w-md w-full mx-auto text-center space-y-4 border border-slate-200 mb-4 md:mb-0">
                                            <div className="text-4xl mb-2">🔒</div>
                                            <h3 className="text-2xl font-black text-slate-900">解鎖完整行動建議</h3>
                                            <p className="text-slate-500 font-bold text-sm md:text-base">
                                                想知道如何突破現狀？<br/>
                                                輸入稱呼與 Email，立即解鎖教練的深度分析與「3天形象急救計畫」。
                                            </p>
                                            
                                            <form 
                                                method="post" 
                                                action="https://systeme.io/embedded/37425881/subscription" 
                                                className="space-y-3 pt-2"
                                                onSubmit={handleSystemeSubmit}
                                            >
                                                <input 
                                                type="text" 
                                                name="first_name" 
                                                placeholder="您的稱呼 (選填)"
                                                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-lg rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none p-3 placeholder-slate-400 font-bold"
                                                />
                                                <input 
                                                type="email" 
                                                name="email" 
                                                required
                                                placeholder="您的 Email (必填)"
                                                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-lg rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none p-3 placeholder-slate-400 font-bold"
                                                />
                                                <button 
                                                type="submit" 
                                                className="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-xl text-xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2"
                                                >
                                                立即解鎖並查看結果 👉
                                                </button>
                                            </form>
                                            <p className="text-[10px] text-slate-400">
                                                我們和您一樣討厭垃圾信！您只會收到相關資訊，且隨時可以取消接收，請同意
                                                <button 
                                                    type="button" 
                                                    onClick={() => setShowPrivacyPolicy(true)} 
                                                    className="underline hover:text-slate-600 mx-1"
                                                >
                                                    [隱私權政策]
                                                </button>
                                                後再點擊送出
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* 只有解鎖後才顯示後續的銷售文案 */}
                        {isResultUnlocked && (
                            <>
                                <div className="py-8 space-y-6">
                                    {/* Next Step Separator: 深色版樣式 */}
                                    <div className="flex items-center space-x-4 w-full justify-center">
                                        <div className="h-px bg-slate-700 flex-1"></div>
                                        <span className="text-[#edae26] font-black tracking-widest uppercase text-sm border border-amber-500/30 px-4 py-1.5 rounded-full bg-slate-800/50 whitespace-nowrap">
                                            YOUR NEXT STEP
                                        </span>
                                        <div className="h-px bg-slate-700 flex-1"></div>
                                    </div>
                                    
                                    {/* Main Title */}
                                    <h4 className="text-center text-white font-bold text-4xl md:text-5xl tracking-tight mb-4">
                                        從「知道」到「做到」
                                    </h4>
                                    
                                    {/* Description */}
                                    <p className="text-lg md:text-xl leading-relaxed text-slate-300 text-justify md:text-center px-4 font-medium">
                                        這份報告指出了你的盲點，但「知道」不等於「做到」。
                                        <span className="text-[#edae26] font-bold">形象建立是你現在最有效的槓桿</span>，
                                        因為它能在短時間內產生明顯的視覺反饋與外界評價。
                                        只要你願意在細節上投入，你的社交機會與心理強度將會產生
                                        <span className="text-[#edae26] font-bold">質的飛躍</span>。
                                        請從今天開始，把打理自己當作一場必要的戰鬥準備。
                                    </p>
                                    
                                    {/* 3-Day Plan Card */}
                                    <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 md:p-8 mt-8 shadow-lg backdrop-blur-sm">
                                        <h5 className="text-[#edae26] text-center font-bold text-2xl md:text-3xl mb-6 tracking-wide">
                                            你的「3天形象急救計畫」
                                        </h5>
                                        
                                        <p className="text-white text-center text-lg md:text-xl mb-8 font-medium leading-relaxed">
                                            單看報告不會讓你變帥。為了幫你把這份診斷轉化為實際的吸引力，我準備了連續三天的「行動指南」寄給你：
                                        </p>
                                        
                                        <div className="space-y-6 max-w-2xl mx-auto">
                                            <div className="flex items-start space-x-4 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                                                <span className="text-2xl mt-1">🗓️</span>
                                                <p className="text-slate-200 text-lg md:text-xl font-medium">
                                                    <span className="font-bold text-white block md:inline mb-1 md:mb-0">明天 (Day 1)：</span>
                                                    整體形象的<span className="text-[#edae26] font-bold">「止損第一步」</span>
                                                </p>
                                            </div>
                                            
                                            <div className="flex items-start space-x-4 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                                                <span className="text-2xl mt-1">🗓️</span>
                                                <p className="text-slate-200 text-lg md:text-xl font-medium">
                                                    <span className="font-bold text-white block md:inline mb-1 md:mb-0">後天 (Day 2)：</span>
                                                    理工男也能懂的<span className="text-[#edae26] font-bold">「萬用穿搭公式」</span>
                                                </p>
                                            </div>
                                            
                                            <div className="flex items-start space-x-4 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
                                                <span className="text-2xl mt-1">🗓️</span>
                                                <p className="text-slate-200 text-lg md:text-xl font-medium">
                                                    <span className="font-bold text-white block md:inline mb-1 md:mb-0">最後 (Day 3)：</span>
                                                    從「路人照片」變身<span className="text-[#edae26] font-bold">「高配對形象」</span>
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="mt-8 text-center pt-6 border-t border-slate-700/50">
                                            <p className="text-[#edae26]/90 text-sm md:text-base font-bold flex items-center justify-center gap-2 tracking-wide">
                                                <span>⚠️</span> 請留意明天晚上的信件，這是你脫單的第一步。
                                            </p>
                                        </div>
                                    </div>

                                    {/* Social Media Buttons */}
                                    <div className="flex flex-col items-center space-y-4 mt-8">
                                        <a href="https://lin.ee/3V3tOsx" target="_blank" rel="noopener noreferrer" className="hover:opacity-90 transition-opacity">
                                            <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f974627f8_69565d2473a52_6956598909c11_zh-Hant.png" alt="加入 LINE 好友" className="h-12 md:h-14 w-auto" />
                                        </a>
                                        <div className="flex space-x-6">
                                            <a href="https://instagram.com/freeven.coach" target="_blank" rel="noopener noreferrer" className="hover:opacity-90 transition-opacity">
                                                <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f9743b2f3_68bcafb31135a_ig.png" alt="Instagram" className="w-10 h-10 md:w-12 md:h-12" />
                                            </a>
                                            <a href="https://www.threads.net/@freeven.coach" target="_blank" rel="noopener noreferrer" className="hover:opacity-90 transition-opacity">
                                                <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6965f97461c7f_695f34230d336_695f20025eaf2_icon2.png" alt="Threads" className="w-10 h-10 md:w-12 md:h-12" />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            
            <div className="flex flex-col space-y-4 pt-4 pb-8 items-center">
               {isResultUnlocked && (
                   <div className="flex flex-col items-center gap-3 mb-2 w-full max-w-xs">
                       <button 
                         onClick={() => sendResultsToWebhook(userEmail, userName, aiAnalysis, localSummary)}
                         disabled={emailStatus === 'sending'}
                         className="w-full bg-white hover:bg-slate-50 text-slate-700 font-bold py-3 px-6 rounded-xl shadow-sm border border-slate-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                       >
                         {emailStatus === 'sending' ? (
                            <>
                                <span className="animate-spin">⏳</span> 發送中...
                            </>
                         ) : (
                            <>
                                <span>📩</span> 再次發送診斷報告
                            </>
                         )}
                       </button>
                       
                       {emailStatus === 'success' && (
                           <div className="text-green-600 text-sm font-bold flex items-center gap-1 animate-fade-in text-center">
                               <span>✓</span> 報告已寄出，請檢查您的收件匣 (含垃圾郵件)
                           </div>
                       )}
                   </div>
               )}
               
               <button onClick={handleStart} className="text-slate-300 font-bold hover:text-slate-500 transition-colors text-base mt-4">
                   重新進行測試
               </button>
            </div>
          </div>
        </div>
      )}

      <footer className="w-full text-center py-10 text-slate-400 text-sm px-6 border-t border-slate-100 mt-auto space-y-2 bg-slate-50">
        <p className="font-bold">© 版權所有 男性形象教練 彭邦典</p>
        <p>本測驗由 AI 輔助生成 ，不涉及任何心理治療或精神診斷，測驗結果僅供參考。</p>
        <button 
          onClick={() => setShowPrivacyPolicy(true)}
          className="text-xs text-slate-300 hover:text-slate-500 underline decoration-slate-300 underline-offset-2 transition-colors pt-2 block mx-auto"
        >
          隱私權政策
        </button>
      </footer>

      {/* Privacy Policy Modal */}
      {showPrivacyPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowPrivacyPolicy(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 md:p-8 relative" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setShowPrivacyPolicy(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            
            <h3 className="text-2xl font-black text-slate-900 mb-6 text-center">隱私權政策</h3>
            
            <div className="space-y-6 text-slate-600 text-sm leading-relaxed text-justify">
              <section>
                <p>歡迎您來到 Menspalais（以下簡稱「本網站」）。我們非常重視您的隱私權，並承諾依據中華民國《個人資料保護法》及相關法令規定，保護您的個人資料。為了讓您能夠安心使用本網站的各項服務與資訊，特此向您說明本網站的隱私權保護政策，以保障您的權益，請您詳閱下列內容：</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">一、 個人資料的蒐集目的與類別</h4>
                <p>當您造訪本網站或使用我們提供的服務（例如：訂閱電子報、填寫表單、預約會談）時，我們將視該服務功能性質，請您提供必要的個人資料。</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>蒐集目的：</strong>包含但不限於客戶管理與服務、行銷（包含寄送電子報及相關優惠資訊）、網站流量與使用者行為分析、以及提供各項優化服務。</li>
                  <li><strong>蒐集類別：</strong>
                    <ul className="list-circle pl-5 mt-1 space-y-1">
                      <li>個人識別資訊：如姓名、電子郵件地址（Email）等。</li>
                      <li>網站使用數據：如 IP 位址、使用時間、使用的瀏覽器、瀏覽及點選資料紀錄、Cookie 等（此類資料主要用於網站流量分析與服務提升，不會和特定個人聯繫）。</li>
                    </ul>
                  </li>
                </ul>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">二、 個人資料利用之期間、地區、對象及方式</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>期間：</strong>本網站營運期間、特定目的存續期間，或依法令所訂之保存年限。當您要求刪除或取消訂閱時，我們將依規停止蒐集、處理或利用您的個人資料。</li>
                  <li><strong>地區：</strong>您的個人資料將用於本網站營運地區及我們所使用的第三方服務平台（如 Systeme.io）伺服器所在地區。</li>
                  <li><strong>對象：</strong>本網站及協助我們提供服務的第三方合作夥伴（如電子報發送系統、網站分析工具）。</li>
                  <li><strong>方式：</strong>以自動化機器或其他非自動化之方式，進行資料的蒐集、處理與利用（包含電子郵件通知、行銷資訊發送等）。</li>
                </ul>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">三、 資訊分享與揭露</h4>
                <p>我們承諾絕不將您的個人資料出售、交換或出租給任何其他團體、個人或私人企業。您的資料僅會在以下情況下進行必要處理：</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>使用第三方服務：</strong>為提供您完善的服務，您的資料將儲存並處理於 Systeme.io 等具備嚴格安全標準的第三方服務平台，該平台亦受嚴格的隱私權規範約束。</li>
                  <li><strong>法規要求：</strong>配合司法單位合法的調查，或依法令相關規定需要揭露時。</li>
                </ul>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">四、 您擁有的個資權利（個資法第 3 條）</h4>
                <p>針對您交付予本網站的個人資料，您依法可隨時向我們行使以下權利：</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>查詢或請求閱覽。</li>
                  <li>請求製給複製本。</li>
                  <li>請求補充或更正。</li>
                  <li>請求停止蒐集、處理或利用。</li>
                  <li>請求刪除。</li>
                </ul>
                <p className="mt-2"><strong>退訂機制：</strong>若您希望停止接收我們的電子報或行銷郵件，您可以隨時點擊信件底部的「取消訂閱（Unsubscribe）」連結，我們將立即從發送名單中移除您的信箱。</p>
                <p>若您欲行使上述其他權利，請隨時透過我們的客服信箱與我們聯繫，我們將盡速為您處理。</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">五、 不提供個人資料所致權益之影響</h4>
                <p>您可自由選擇是否提供個人資料。若您拒絕提供特定服務所需的必要個人資料（例如未填寫正確的 Email），本網站將可能無法為您提供完整的服務（例如無法成功訂閱電子報或安排會談），敬請見諒。</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">六、 Cookie 技術與使用</h4>
                <p>為了提供您最佳的服務，本網站會在您的電腦中放置並取用我們的 Cookie。Cookie 是網站伺服器用來和使用者瀏覽器進行溝通的一種技術，能為您提供更個人化的體驗。</p>
                <p className="mt-2"><strong>您的選擇權：</strong>若您不願接受 Cookie 的寫入，您可在您使用的瀏覽器功能項中設定隱私權等級為高，即可拒絕 Cookie 的寫入，但這可能會導致網站某些功能無法正常執行。</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">七、 未成年人保護</h4>
                <p>本網站之服務並非專為未成年人（未滿 18 歲）設計。我們不會在知情的情況下，主動蒐集未成年人的個人資料。若您是未成年人，請在您的法定代理人或監護人陪同與同意下，再使用本網站之服務。</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">八、 隱私權政策之修改</h4>
                <p>本網站保留隨時修改本隱私權政策的權利，以因應社會環境及法令的變遷與科技的進步。政策修改後將直接發布於本網站上，重大變更時我們將透過網站公告或電子郵件通知您。建議您定期檢閱本政策，以確保了解我們最新的隱私權保護措施。</p>
              </section>

              <section>
                <h4 className="font-bold text-slate-800 text-base mb-2">九、 聯絡我們</h4>
                <p>如果您對本隱私權政策、您的個人資料處理方式，或有任何與隱私權相關的疑問，歡迎隨時透過以下電子郵件聯繫我們：<a href="mailto:freeven@menspalais.com" className="text-blue-600 hover:underline">freeven@menspalais.com</a></p>
              </section>
            </div>
            
            <div className="mt-8 text-center">
              <button 
                onClick={() => setShowPrivacyPolicy(false)}
                className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors shadow-lg active:scale-95 transform transition-transform"
              >
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
