
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { QUESTIONS, OPTIONS, CATEGORY_INFO, PERSONAS, EXPERT_CONFIG, CATEGORY_IMAGES } from './constants';
import { Category } from './types';
import Chart from 'chart.js/auto';

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

  // Refs
  const aiFetchingRef = useRef(false); // 防止重複呼叫 AI
  const lastFetchTimeRef = useRef<number>(0); // 防止 React StrictMode 導致的瞬間雙重請求
  const radarChartRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstance = useRef<any>(null);

  // 用於邏輯的狀態 (不顯示於 UI)
  const [lastError, setLastError] = useState<string>('');

  // 新增：文字格式化工具函數 (解析 **重點** 語法)
  const renderFormattedText = (text: string, highlightClass: string = 'text-amber-400') => {
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

  const handleStart = () => {
    setStep('quiz');
    setCurrentIdx(0);
    setIsIntroMode(true);
    setAnswers({});
    setAiAnalysis(null);
    setFakeProgress(0);
    setLastError('');
    setShowKeyInput(false);
    aiFetchingRef.current = false;
    lastFetchTimeRef.current = 0;
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

  useEffect(() => {
    if (step === 'diagnosing' && aiAnalysis) {
      setFakeProgress(100);
      const timer = setTimeout(() => {
        setStep('result');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [step, aiAnalysis]);

  const localSummary = useMemo(() => {
    if (step !== 'result' && step !== 'diagnosing') return null;
    const categories: Category[] = ['面容氣色', '髮型駕馭', '穿搭策略', '社群形象'];
    const summary = categories.map(cat => {
      const catQuestions = QUESTIONS.filter(q => q.category === cat);
      // 計算分數時，將 -1 (我不確定) 視為 0 分處理
      const score = catQuestions.reduce((acc, q) => {
          const val = answers[q.id];
          return acc + (val === -1 ? 0 : (val || 0));
      }, 0);
      
      // 滿分 15 分 (5題 * 3分)
      let level: '紅燈' | '黃燈' | '綠燈' = '紅燈';
      let color = '#ef4444'; 
      if (score >= 12) { level = '綠燈'; color = '#22c55e'; }
      else if (score >= 7) { level = '黃燈'; color = '#f97316'; }
      return { category: cat, score, level, color, description: CATEGORY_INFO[cat].description, suggestion: CATEGORY_INFO[cat].suggestions[level] };
    });

    const totalScore = summary.reduce((acc, curr) => acc + curr.score, 0);
    return { summary, totalScore };
  }, [step, answers]);

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

    // 更新這裡：優先讀取 overrideKey, 然後是 customApiKey, 最後是環境變數 GEMINI_API_KEY
    const apiKeyToUse = overrideKey || customApiKey || process.env.GEMINI_API_KEY;

    if (!apiKeyToUse) {
      console.error("API Key is missing.");
      setLastError("系統設定：請輸入 API Key");
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
          "coachGeneralAdvice": "教練的總結戰略建議 (約 200 字)。**請務必分成 2-3 個段落撰寫，不要寫成一大塊文字**，段落間請留空行，讓閱讀更輕鬆。**結尾必須嚴格包含此句**：「請記住，知道問題不等於能解決問題，形象的改造涉及到對自我的認識與系統化的打扮邏輯，若無系統性訓練很容易走彎路、花冤枉錢，你需要查看下方的『5週變身計畫』，讓我陪你把這塊原石磨出光彩。」"
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
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
            plugins: { legend: { display: false } },
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
          <div className="text-center space-y-2 md:space-y-4">
            <h1 className="text-3xl md:text-7xl font-black text-slate-900 tracking-tighter leading-tight">形象力檢核分析</h1>
            <div className="space-y-1 md:space-y-2">
                <p className="text-lg md:text-3xl text-slate-500 font-bold">專為 25-35 歲男性設計</p>
                <p className="text-lg md:text-3xl text-slate-500 font-bold">找出阻礙你散發魅力的形象盲點</p>
            </div>
          </div>

          <div className="relative w-full aspect-[4/3] flex items-center justify-center animate-float overflow-visible">
             <img src="https://d1yei2z3i6k35z.cloudfront.net/2452254/6950d78862cc9_43.png" className="object-contain w-full h-full drop-shadow-2xl" />
          </div>

          <div className="px-2 md:px-4 w-full">
            <button 
              onClick={handleStart} 
              className="w-full relative overflow-hidden bg-slate-900 hover:bg-black text-white font-black py-4 md:py-7 rounded-[2rem] md:rounded-[2.5rem] text-2xl md:text-3xl shadow-2xl transition transform active:scale-95 text-center group animate-shimmer"
            >
              <span className="relative z-10">啟動形象診斷</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:gap-6 px-2 md:px-4">
            {[
              { icon: '✨', title: '魅力原型', desc: '找出你的原生氣質定位', color: 'rgba(244, 63, 94, 0.4)' },
              { icon: '📐', title: '四維分析', desc: '膚況/髮型/穿搭/社群', color: 'rgba(59, 130, 246, 0.4)' },
              { icon: '🕴️', title: '教練建議', desc: '獲得個人的變身戰略', color: 'rgba(16, 185, 129, 0.4)' }
            ].map((feature, i) => (
              <div key={i} className="flex items-center space-x-4 md:space-x-6 bg-white p-5 md:p-6 rounded-[2rem] md:rounded-[2.5rem] shadow-sm border border-slate-100 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 group cursor-default">
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
              <div className="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-slate-100 text-center flex flex-col items-center">
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
                <div className="bg-white p-5 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-xl border border-slate-100 min-h-[160px] md:min-h-[200px] flex items-center justify-center">
                  <h2 className="text-xl md:text-3xl font-black text-slate-800 text-center leading-relaxed px-1 md:px-4">{QUESTIONS[currentIdx].text}</h2>
                </div>
                
                <div className="space-y-2.5 md:space-y-3">
                  {OPTIONS.map((opt, idx) => {
                    const isSelected = answers[QUESTIONS[currentIdx].id] === opt.value;
                    return (
                      <button 
                        key={opt.value} 
                        onClick={() => handleAnswer(opt.value)} 
                        className={`group w-full p-3.5 md:p-6 rounded-2xl border-2 transition-all duration-200 flex items-center justify-between animate-pop-in
                          ${isSelected 
                            ? 'border-blue-600 bg-blue-50 shadow-md scale-[0.98]' 
                            : 'border-slate-50 bg-white hover:border-blue-200 hover:bg-slate-50 hover:-translate-y-1 hover:shadow-md'
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
            </>
          ) : (
            <div className="space-y-6 bg-white p-8 rounded-[2.5rem] shadow-xl border-2 border-slate-200 max-w-md w-full animate-fade-in">
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
        <div className="w-full space-y-10 animate-fade-in pb-12">
          <div className="bg-white rounded-b-[2.5rem] md:rounded-[3.5rem] shadow-2xl overflow-hidden border-b md:border border-slate-100 animate-slide-up" style={{ animationDelay: '0ms' }}>
            <div className="relative aspect-[3/4] md:aspect-[21/9] flex items-end justify-center bg-gray-900">
              <img src={activePersona.imageUrl} alt={activePersona.title} className="w-full h-full object-cover object-top" />
              <div className="absolute bottom-0 left-0 p-6 md:p-10 text-white bg-gradient-to-t from-black/90 via-black/50 to-transparent w-full pt-24 md:pt-32">
                <div className="flex flex-col items-start space-y-1 mb-2">
                   <span className="bg-blue-600 text-white text-[10px] md:text-xs font-bold px-2 md:px-3 py-1 rounded-full uppercase tracking-wider">Persona</span>
                </div>
                <h2 className="text-3xl md:text-6xl font-black tracking-tight mb-2 leading-tight">{activePersona.title}</h2>
                <p className="text-lg md:text-3xl font-medium text-white/90 italic leading-snug">
                  {/* 使用 renderFormattedText 來解析 '**' 並給予黃色高亮，同時避免顯示星號 */}
                  {renderFormattedText(aiAnalysis.personaOverview || activePersona.subtitle, 'text-amber-400')}
                </p>
              </div>
            </div>
            <div className="p-8 md:p-10 space-y-8">
              <div className="flex flex-wrap gap-3">
                {activePersona.tags.map((tag, i) => (
                  <span key={tag} className="px-6 py-3 bg-slate-100 text-slate-800 rounded-full text-xl font-black border border-slate-200 animate-pop-in" style={{ animationDelay: `${i * 100 + 300}ms` }}># {tag}</span>
                ))}
              </div>
              <div className="p-6 bg-blue-50/50 rounded-[2rem] border border-blue-100">
                 <h5 className="text-blue-600 font-black text-2xl uppercase tracking-widest mb-3">人格診斷分析</h5>
                 <div className="space-y-6">
                    {aiAnalysis.personaExplanation.split('\n').filter(line => line.trim() !== '').map((line, idx) => (
                        <p key={idx} className="text-slate-800 text-lg md:text-xl leading-relaxed font-bold">
                            {renderFormattedText(line, 'text-blue-700')}
                        </p>
                    ))}
                 </div>
              </div>
            </div>
          </div>

          <div className="px-4 md:px-0 space-y-10">
            <div className="bg-white p-6 md:p-10 rounded-[3rem] shadow-xl border border-slate-50 text-center animate-slide-up" style={{ animationDelay: '200ms' }}>
                <div className="text-4xl md:text-5xl font-black text-slate-800 mb-8">形象總分：<span className="text-blue-600">{localSummary.totalScore}</span> <span className="text-slate-300 text-xl">/ 60</span></div>
                <div className="h-[20rem] md:h-[24rem] mb-6"><canvas ref={radarChartRef}></canvas></div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <div className="text-center py-4 animate-slide-up" style={{ animationDelay: '300ms' }}>
                    <h3 className="text-3xl font-black text-slate-900 tracking-tighter">四大形象支柱深度剖析</h3>
                    <p className="text-xl text-slate-400 font-bold"> 針對你的回答細節產生的專屬建議</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {localSummary.summary.map((item, idx) => (
                    <div key={item.category} className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-lg border border-slate-100 flex flex-col space-y-4 relative overflow-hidden group hover:shadow-xl transition-all animate-slide-up" style={{ animationDelay: `${idx * 100 + 400}ms` }}>
                        <div className={`absolute top-0 left-0 w-2 h-full ${item.level === '綠燈' ? 'bg-green-500' : item.level === '黃燈' ? 'bg-orange-400' : 'bg-red-500'}`}></div>
                        <div className="flex items-center justify-between pl-4">
                            <h4 className="text-2xl font-black text-slate-800">{item.category}</h4>
                            <span className={`px-4 py-1.5 rounded-full text-base font-black ${item.level === '綠燈' ? 'bg-green-100 text-green-700' : item.level === '黃燈' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                            {item.level} ({item.score}分)
                            </span>
                        </div>
                        <p className="text-lg md:text-xl text-slate-600 leading-relaxed pl-4 text-justify font-medium">
                        {renderFormattedText(getAiAnalysisForCategory(item.category), 'text-slate-900')}
                        </p>
                    </div>
                    ))}
                </div>
            </div>

            {activePersona.id === 'charmer' ? (
                <div className="bg-gradient-to-br from-slate-900 to-black rounded-[3.5rem] shadow-2xl p-10 md:p-14 text-center space-y-8 animate-fade-in border border-slate-800">
                <div className="text-6xl md:text-8xl">🏆</div>
                <h4 className="text-3xl md:text-4xl font-black text-white">你已是頂級魅力家</h4>
                <p className="text-slate-300 text-xl md:text-2xl font-bold">教練對你唯一的建議是：好好善用這份天賦。祝你一帆風順！</p>
                </div>
            ) : (
                <div className="rounded-[3.5rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col bg-white animate-slide-up" style={{ animationDelay: '600ms' }}>
                <div className="w-full relative">
                    <img src={EXPERT_CONFIG.imageUrl} alt="Expert Coach" className="w-full h-auto block object-cover" />
                </div>
                <div className="bg-slate-900 p-8 md:p-12 space-y-8 flex-1">
                    <div className="space-y-6">
                    <div className="flex items-center space-x-3">
                        <span className="text-3xl">💡</span>
                        <h3 className="text-3xl font-black text-amber-400 tracking-tight">教練總結</h3>
                    </div>
                    <div className="space-y-6 md:space-y-8">
                        {aiAnalysis.coachGeneralAdvice.split('\n').filter(line => line.trim() !== '').map((line, idx) => (
                        <p key={idx} className="text-xl md:text-2xl leading-loose font-bold text-white text-justify tracking-wide">
                            {renderFormattedText(line, 'text-amber-400')}
                        </p>
                        ))}
                    </div>
                    
                    <div className="py-8">
                         <div className="flex items-center space-x-4 mb-4">
                             <div className="h-px bg-slate-700 flex-1"></div>
                             <span className="text-amber-400 font-black tracking-widest uppercase text-base border border-amber-400/30 px-4 py-1.5 rounded-full bg-amber-400/10">
                                Your Next Step
                             </span>
                             <div className="h-px bg-slate-700 flex-1"></div>
                         </div>
                         <h4 className="text-center text-white font-bold text-3xl md:text-4xl tracking-tight mb-8">形象是可以學習的技能</h4>
                    </div>

                    <div className="space-y-8">
                        <p className="text-xl md:text-2xl leading-relaxed font-bold text-white text-center">
                            你真正需要的不是只變帥那一天的單次服務，<br className="hidden md:block" />
                            而是擁有一套<span className="text-slate-200">可立即複製套用的形象公式</span>，<br className="hidden md:block" />能夠<span className="text-slate-200">展示自己最好的一面</span>。
                        </p>
                        
                        <p className="text-xl md:text-2xl leading-relaxed font-medium text-white text-center py-4">
                            我將這七年的實戰與教學經驗，簡化為好懂、好複製的系統化SOP，<br className="hidden md:block" />
                            正式名稱：<span className="text-amber-400 font-black text-1xl md:text-2xl">SOLAR戀愛形象系統</span>
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[
                                { title: '獨家 SOP', desc: '一套能精準解決形象問題的實戰模組' },
                                { title: '底層邏輯', desc: '能夠打造自己的最大魅力' },
                                { title: '實戰陪跑', desc: '每週作業與教練親自點評' }
                            ].map((feature, i) => (
                                <div key={i} className="bg-slate-800/50 border border-slate-700 p-4 rounded-2xl flex flex-col items-center text-center space-y-2">
                                    <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-900 flex items-center justify-center font-black">✓</div>
                                    <h5 className="text-white font-bold text-xl">{feature.title}</h5>
                                    <p className="text-slate-200 text-sm font-medium">{feature.desc}</p>
                                </div>
                            ))}
                        </div>

                        {EXPERT_CONFIG.description.split('\n\n').map((paragraph, index) => (
                            <p key={index} className="text-xl md:text-2xl leading-relaxed font-medium text-white text-justify">
                                {renderFormattedText(paragraph, 'text-amber-400')}
                            </p>
                        ))}
                    </div>

                    </div>
                    <button onClick={() => window.open('https://www.menspalais.com', '_blank')} className="group w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-black py-4 md:py-6 rounded-[2rem] text-2xl md:text-3xl shadow-xl shadow-amber-900/20 flex items-center justify-center space-x-2 md:space-x-3 transition-all transform active:scale-95 mt-4 hover:shadow-2xl hover:-translate-y-1 relative overflow-hidden">
                       <span className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out skew-x-12"></span>
                       
                       <div className="flex flex-col items-center justify-center leading-none py-1">
                           <span className="text-xl md:text-3xl font-black tracking-tight">查看 5 週變身計畫</span>
                           <span className="text-sm md:text-lg font-bold opacity-90 mt-1 tracking-wide">(每月僅收 3 人)</span>
                       </div>

                       <svg className="w-8 h-8 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                    </button>
                    <p className="text-center text-slate-500 text-white font-bold text-lg">⚠️ 名額有限，優先卡位</p>
                </div>
                </div>
            )}
            
            <div className="text-center pb-8"><button onClick={handleStart} className="text-slate-400 font-black uppercase tracking-widest hover:text-slate-600 transition-colors text-lg">重新進行測試</button></div>
          </div>
        </div>
      )}

      <footer className="w-full text-center py-10 text-slate-400 text-sm px-6 border-t border-slate-100 mt-auto space-y-2 bg-slate-50">
        <p className="font-bold">© 版權所有 男性形象教練 彭邦典</p>
        <p>本測驗由 AI 輔助生成 ，不涉及任何心理治療或精神診斷，測驗結果僅供參考。</p>
      </footer>
    </div>
  );
};

export default App;
