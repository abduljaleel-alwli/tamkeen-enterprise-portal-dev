/**
 * HMAC digests only. The six-digit access codes and the HMAC pepper are never
 * shipped in the application source or stored in plaintext in D1.
 */
export const INITIAL_ACCESS_CODE_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  "qa.admin@example.com": "f9bbb13e4c5bfb2c325f044c5897373857c2552fc57485f16c467e11f8052b7f",
  "qa.executive@example.com": "6a10343a522638b91cdaa4f031857d1cb430a49e6017c866659d2b447b245b14",
  "qa.head@example.com": "adf5b0927cd1adc51992e71fffd96d093aee80cc87d6e4cc5b45b4404496d115",
  "qa.supervisor@example.com": "804ffc315e7b7abd60df20782df7ae0c9334c96814c3cc1f04c2da70a7e1b44c",
  "qa.sales@example.com": "b70bf77921bdb6f011fef05cd0ff8e84a755af7e11ff42530bd0eac8ffd18434",
  "qa.employee@example.com": "f53e781397f962c4ef20fbd69669f013e4e8529fc835126d45e05dc1281d5cee",
});

/** رموز أعيد إصدارها لهذه الحسابات وتظل مؤقتة حتى تفعيل OTP الفعلي. */
export const ROTATED_ACCESS_CODE_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
});
