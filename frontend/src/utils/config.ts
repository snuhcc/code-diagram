// API URL을 환경에 따라 동적으로 선택하는 유틸리티
export const getApiUrl = (): string => {
  // NEXT_PUBLIC_USE_NGROK 환경 변수가 설정되어 있으면 NGROK URL 사용
  console.log('NEXT_PUBLIC_USE_NGROK:', process.env.NEXT_PUBLIC_USE_NGROK);
  if (process.env.NEXT_PUBLIC_USE_NGROK === 'true') {
    return process.env.NEXT_PUBLIC_API_BASE_URL_NGROK || '';
  }
  // 기본적으로는 일반 API URL 사용
  return process.env.NEXT_PUBLIC_API_BASE_URL || '';
};

export const getTargetFolder = (): string => {
  return process.env.NEXT_PUBLIC_TARGET_FOLDER || '';
};
