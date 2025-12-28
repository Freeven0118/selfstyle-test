
export type Category = '面容氣色' | '髮型駕馭' | '穿搭策略' | '社群形象';

export interface Question {
  id: number;
  category: Category;
  text: string;
  imageUrl?: string;
}

export interface DimensionResult {
  category: Category;
  score: number;
  level: '紅燈' | '黃燈' | '綠燈';
  color: string;
  description: string;
  suggestion: string;
}

export interface Answer {
  questionId: number;
  score: number;
}
