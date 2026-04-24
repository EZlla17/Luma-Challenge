const PROMPT_FRAMEWORKS = [
  {
    id: "apply-style",
    lead: "Apply style",
    trail: " from image",
    searchText: "apply style from image",
  }
];
const mainPrompt = "app";
const lower = mainPrompt.toLowerCase();
const mainFilteredFrameworks = PROMPT_FRAMEWORKS.filter((f) =>
  f.searchText.toLowerCase().includes(lower) || f.id.toLowerCase().includes(lower)
);
const mainPredictedFramework = mainFilteredFrameworks.find((f) => !f.disabled) ?? null;
const full = `${mainPredictedFramework.lead}${mainPredictedFramework.trail}`;
const lowerFull = full.toLowerCase();
const lowerInput = mainPrompt.toLowerCase();
console.log(lowerFull.startsWith(lowerInput));
console.log(full.slice(mainPrompt.length));
