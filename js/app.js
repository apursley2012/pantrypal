const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MEALS = [
  { key: "Breakfast", icon: "☀️" },
  { key: "Lunch", icon: "🌤️" },
  { key: "Dinner", icon: "🌙" },
  { key: "Snack", icon: "⭐" }
];
const STORE = {
  inventory: "pantrypal.inventory",
  favorites: "pantrypal.favorites",
  plan: "pantrypal.plan",
  customRecipes: "pantrypal.customRecipes",
  groceries: "pantrypal.groceries",
  groceryChecked: "pantrypal.groceryChecked",
  favoriteNotes: "pantrypal.favoriteNotes",
  plannerView: "pantrypal.plannerView",
  plannerDate: "pantrypal.plannerDate",
  recentRecipes: "pantrypal.recentRecipes"
};
const LEGACY = {
  ingredients: "mealplanner.multi.ingredients",
  favorites: "mealplanner.multi.favorites",
  plan: "mealplanner.multi.plan"
};

const $ = (selector) => document.querySelector(selector);
let inventory = loadInventory();
let favorites = load(STORE.favorites, load(LEGACY.favorites, []));
let customRecipes = load(STORE.customRecipes, []);
let plan = normalizePlan(load(STORE.plan, load(LEGACY.plan, {})));
let manualGroceries = load(STORE.groceries, []);
let groceryChecked = load(STORE.groceryChecked, {});
let favoriteNotes = load(STORE.favoriteNotes, {});
let activeRecipeId = null;
let dialogServingTarget = null;
let plannerView = load(STORE.plannerView, "week");
let plannerDate = new Date(load(STORE.plannerDate, new Date().toISOString().slice(0,10)) + "T12:00:00");

function allRecipes() { return [...RECIPES, ...customRecipes]; }
function ingredientNames() { return inventory.map(i => i.name); }

function init() {
  document.addEventListener("error", handleRecipeImageError, true);
  bindGlobalDialogs();
  migrateStores();
  updateStats();
  if ($("#mealGrid")) renderPlanner();
  if ($("#ingredientChips")) renderIngredientsPage();
  renderCommonIngredientChoices();
  if ($("#recipeMatches")) renderMatches();
  if ($("#recipeGrid")) { buildCategoryFilter(); renderRecipeLibrary(); bindQuickSearches(); }
  if ($("#groceryItems")) renderGroceryList();
  if ($("#favoriteRecipes")) { buildFavoriteCategory(); renderFavorites(); }
  if ($("#suggestionText") || $("#suggestionTitle")) renderSuggestion();
  if ($("#onlineStatus")) updateOnlineLinks();
  if ($("#customRecipeList")) renderCustomRecipes();
  if ($("#homeRecommendations")) renderHomeDashboard();
  bindPageEvents();
  initIngredientWorkspace();
  bindDataTools();
  announce("PantryPal ready");
}

function migrateStores() {
  save(STORE.inventory, inventory);
  save(STORE.favorites, favorites);
  save(STORE.plan, plan);
}

function bindPageEvents() {
  $("#addIngredientButton")?.addEventListener("click", addIngredients);
  $("#ingredientInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addIngredients(); } });
  $("#addDetailedIngredientButton")?.addEventListener("click", addDetailedIngredient);
  $("#clearIngredientsButton")?.addEventListener("click", () => {
    if (!confirm("Clear all saved ingredients?")) return;
    inventory = []; save(STORE.inventory, inventory); renderIngredientsPage(); renderMatches(); updateStats(); updateOnlineLinks();
  });
  $("#exportIngredientsButton")?.addEventListener("click", () => downloadJSON("pantrypal-inventory.json", inventory));
  $("#importIngredientsInput")?.addEventListener("change", importIngredients);

  $("#recipeSearch")?.addEventListener("input", resetRecipeLibraryAndRender);
  $("#categoryFilter")?.addEventListener("change", resetRecipeLibraryAndRender);
  $("#collectionFilter")?.addEventListener("change", resetRecipeLibraryAndRender);
  $("#maxMissingFilter")?.addEventListener("change", resetRecipeLibraryAndRender);
  $("#matchMissingFilter")?.addEventListener("change", ()=>{ renderMatches(); queueAutomaticOnlineSearch(); });
  $("#recipeSort")?.addEventListener("change", resetRecipeLibraryAndRender);

  $("#favoriteSearch")?.addEventListener("input", renderFavorites);
  $("#favoriteCategory")?.addEventListener("change", renderFavorites);

  $("#suggestionButton")?.addEventListener("click", () => { const r = getSuggestedRecipe(); if (r) openRecipe(r.id); });

  $("#onlineSearchButton")?.addEventListener("click", searchOnline);
  $("#clearOnlineButton")?.addEventListener("click", () => { $("#onlineResults").innerHTML = ""; $("#onlineStatus").textContent = "Online results cleared."; });

  $("#previousPeriodButton")?.addEventListener("click", () => shiftPlanner(-1));
  $("#nextPeriodButton")?.addEventListener("click", () => shiftPlanner(1));
  $("#todayButton")?.addEventListener("click", () => { plannerDate = new Date(); persistPlannerState(); renderPlanner(); });
  $("#weekViewButton")?.addEventListener("click", () => { plannerView = "week"; persistPlannerState(); renderPlanner(); });
  $("#monthViewButton")?.addEventListener("click", () => { plannerView = "month"; persistPlannerState(); renderPlanner(); });
  $("#clearPlanButton")?.addEventListener("click", clearCurrentPlanView);
  $("#printPlanButton")?.addEventListener("click", () => window.print());
  $("#exportPlanButton")?.addEventListener("click", exportPlan);

  $("#addManualGroceryButton")?.addEventListener("click", addManualGrocery);
  $("#manualGroceryInput")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addManualGrocery(); } });
  $("#clearCheckedGroceriesButton")?.addEventListener("click", clearCheckedGroceries);
  $("#printGroceriesButton")?.addEventListener("click", () => window.print());
  $("#exportGroceriesButton")?.addEventListener("click", exportGroceries);

  $("#customRecipeForm")?.addEventListener("submit", saveCustomRecipeFromForm);
  $("#cancelRecipeEdit")?.addEventListener("click", resetCustomRecipeForm);
  $("#exportRecipesButton")?.addEventListener("click", () => downloadJSON("pantrypal-my-recipes.json", customRecipes));
  $("#importRecipesInput")?.addEventListener("change", importCustomRecipes);
}

function bindGlobalDialogs() {
  const dialog = $("#recipeDialog");
  if (!dialog) return;
  $("#closeRecipeDialog")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
  $("#dialogPlanButton")?.addEventListener("click", () => { if (!activeRecipeId) return; addRecipeToNextOpenSlot(activeRecipeId); dialog.close(); location.href = "planner.html"; });
  $("#dialogFavoriteButton")?.addEventListener("click", () => { if (!activeRecipeId) return; toggleFavorite(activeRecipeId); updateDialogFavoriteButton(); });
}

function ensureDialogExtras() {
  const dialog = $("#recipeDialog .dialog-card");
  if (!dialog) return;
  if (dialog.querySelector(".serving-controls")) {
    const existing = dialog.querySelector(".serving-controls");
    if (!existing.id) existing.id = "dialogServingControls";
    $("#servingsDown")?.addEventListener("click", () => changeDialogServings(-1));
    $("#servingsUp")?.addEventListener("click", () => changeDialogServings(1));
    $("#dialogPrintButton")?.addEventListener("click", () => window.print());
    return;
  }
  const title = $("#dialogTitle");
  const controls = document.createElement("div");
  controls.id = "dialogServingControls";
  controls.className = "serving-controls";
  controls.innerHTML = '<button id="servingsDown" class="soft-button" type="button">−</button><strong id="dialogServings"></strong><button id="servingsUp" class="soft-button" type="button">+</button>';
  title.insertAdjacentElement("afterend", controls);
  const instructionsP = $("#dialogInstructions");
  if (instructionsP) { const ol = document.createElement("ol"); ol.id = "dialogInstructionsList"; instructionsP.replaceWith(ol); }
  const actions = dialog.querySelector(".dialog-actions");
  if (actions && !$("#dialogPrintButton")) actions.insertAdjacentHTML("beforeend", '<button id="dialogPrintButton" class="soft-button" type="button">Print recipe</button>');
  $("#servingsDown")?.addEventListener("click", () => changeDialogServings(-1));
  $("#servingsUp")?.addEventListener("click", () => changeDialogServings(1));
  $("#dialogPrintButton")?.addEventListener("click", () => window.print());
}

function updateStats() {
  if ($("#recipeCount")) $("#recipeCount").textContent = allRecipes().length;
  if ($("#favoriteCount")) $("#favoriteCount").textContent = favorites.length;
  if ($("#ingredientCount")) $("#ingredientCount").textContent = inventory.length;
}

function loadInventory() {
  const current = load(STORE.inventory, null);
  if (Array.isArray(current)) return current.map(toInventoryItem).filter(i => i.name);
  return [];
}
function normalizedIngredientName(value){
  return ingredientKey(value) || clean(value);
}
function toInventoryItem(value) {
  if (typeof value === "string") {
    const name=normalizedIngredientName(value);
    return { id: uid(), name, key:name, quantity: 1, unit: "item", category: "Other", expiry: "" };
  }
  const name=normalizedIngredientName(value?.name);
  return {
    id:value?.id||uid(), name, key:name,
    quantity:Number(value?.quantity||1), unit:value?.unit||"item",
    category:value?.category||"Other", expiry:value?.expiry||""
  };
}
const COMMON_INGREDIENTS = ["eggs", "milk", "butter", "cheese", "bread", "rice", "pasta", "potatoes", "onions", "garlic", "tomatoes", "carrots", "bell peppers", "spinach", "lettuce", "chicken", "ground beef", "tuna", "black beans", "chickpeas", "lentils", "oats", "flour", "sugar", "peanut butter", "bananas", "apples", "frozen vegetables", "corn", "tortillas", "yogurt", "broth", "canned tomatoes", "olive oil", "vegetable oil", "salt", "black pepper"];

function renderCommonIngredientChoices(){
  const wrap=$("#commonIngredientChoices");
  if(!wrap) return;
  wrap.innerHTML=COMMON_INGREDIENTS.map(name=>{
    const key=ingredientKey(name);
    const selected=inventory.some(i=>ingredientKey(i.name)===key);
    return `<button type="button" class="common-ingredient-chip ${selected?"selected":""}" data-common-ingredient="${escapeHTML(name)}">${escapeHTML(titleCase(name))}</button>`;
  }).join("");

  wrap.querySelectorAll("[data-common-ingredient]").forEach(button=>button.addEventListener("click",()=>{
    const name=button.dataset.commonIngredient;
    const key=ingredientKey(name);
    const existing=inventory.find(i=>ingredientKey(i.name)===key);
    if(existing) inventory=inventory.filter(i=>i.id!==existing.id);
    else upsertInventory({name});
    persistInventory();
  }));
}

function addIngredients() {
  const input = $("#ingredientInput"); if (!input) return;
  input.value.split(",").map(clean).filter(Boolean).forEach(name => upsertInventory({name}));
  input.value = ""; persistInventory();
}
function addDetailedIngredient() {
  const name = clean($("#inventoryName")?.value); if (!name) return $("#inventoryName")?.focus();
  upsertInventory({ name, quantity: Number($("#inventoryQuantity")?.value || 1), unit: $("#inventoryUnit")?.value || "item", category: $("#inventoryCategory")?.value || "Other", expiry: $("#inventoryExpiry")?.value || "" });
  $("#inventoryName").value = ""; persistInventory();
}
function upsertInventory(item) {
  const name=normalizedIngredientName(item?.name);
  if(!name) return;
  const key=ingredientKey(name);
  const existing=inventory.find(i=>ingredientKey(i.key||i.name)===key);
  if(existing){
    existing.name=name; existing.key=key;
    existing.quantity=item.quantity ?? existing.quantity;
    existing.unit=item.unit||existing.unit;
    existing.category=item.category||existing.category;
    existing.expiry=item.expiry||existing.expiry;
  } else {
    inventory.push(toInventoryItem({...item,name}));
  }
}
function persistInventory() { save(STORE.inventory, inventory); renderIngredientsPage(); renderCommonIngredientChoices(); renderMatches(); renderRecipeLibrary(); renderSuggestion(); updateStats(); updateOnlineLinks(); announce("Ingredient inventory updated"); }
function renderIngredientsPage() {
  if (!$("#ingredientChips")) return;
  $("#ingredientChips").innerHTML = inventory.length ? inventory.map(i => `<button class="chip" type="button" data-remove-ingredient="${escapeHTML(i.id)}">${escapeHTML(titleCase(i.name))}<span aria-hidden="true">×</span></button>`).join("") : '<p class="empty-message">Add ingredients to find matching recipes.</p>';
  document.querySelectorAll("[data-remove-ingredient]").forEach(b => b.addEventListener("click", () => { inventory = inventory.filter(i => i.id !== b.dataset.removeIngredient); persistInventory(); }));
  if ($("#inventoryList")) {
    $("#inventoryList").innerHTML = inventory.map(i => `<article class="inventory-row"><div><strong>${escapeHTML(titleCase(i.name))}</strong><small>${escapeHTML(String(i.quantity))} ${escapeHTML(i.unit)} • ${escapeHTML(i.category)}${i.expiry ? ` • expires ${escapeHTML(i.expiry)}` : ""}</small></div><div class="row-actions"><button class="text-button" data-edit-inventory="${i.id}" type="button">Edit</button><button class="text-button danger" data-delete-inventory="${i.id}" type="button">Delete</button></div></article>`).join("");
    document.querySelectorAll("[data-edit-inventory]").forEach(b => b.addEventListener("click", () => editInventory(b.dataset.editInventory)));
    document.querySelectorAll("[data-delete-inventory]").forEach(b => b.addEventListener("click", () => { inventory = inventory.filter(i => i.id !== b.dataset.deleteInventory); persistInventory(); }));
  }
}
function editInventory(id) {
  const i = inventory.find(x => x.id === id); if (!i) return;
  const name = prompt("Ingredient name", i.name); if (name === null) return;
  const qty = prompt("Quantity", i.quantity); if (qty === null) return;
  const unit = prompt("Unit", i.unit); if (unit === null) return;
  i.name = clean(name) || i.name; i.quantity = Number(qty) || i.quantity; i.unit = unit || i.unit; persistInventory();
}
async function importIngredients(e) {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text(); let items = [];
  try { const parsed = JSON.parse(text); items = Array.isArray(parsed) ? parsed : parsed.inventory || []; }
  catch { items = text.split(/\r?\n/).flatMap(line => line.split(",")).map(x => x.trim()).filter(Boolean); }
  items.forEach(x => upsertInventory(typeof x === "string" ? {name:x} : x)); persistInventory(); e.target.value = "";
}

function recipeMatch(recipe) {
  const pantry=[...new Set(ingredientNames().map(ingredientKey).filter(Boolean))];
  const needs=[...new Set((recipe.ingredients||[]).map(ingredientKey).filter(Boolean))];

  const matchedNeeds=needs.filter(need=>pantry.some(have=>ingredientKeysMatch(need,have)));
  const missingKeys=needs.filter(need=>!matchedNeeds.includes(need));
  const pantryUsed=pantry.filter(have=>needs.some(need=>ingredientKeysMatch(need,have)));

  const matched=(recipe.ingredients||[]).filter(ri=>pantry.some(pi=>ingredientKeysMatch(ingredientKey(ri),pi)));
  const missing=(recipe.ingredients||[]).filter(ri=>!pantry.some(pi=>ingredientKeysMatch(ingredientKey(ri),pi)));

  const score=needs.length?Math.round((matchedNeeds.length/needs.length)*100):0;
  const pantryScore=pantry.length?Math.round((pantryUsed.length/pantry.length)*100):0;

  return {
    recipe, matched, missing,
    matchedKeys:matchedNeeds, missingKeys,
    matchedCount:matchedNeeds.length,
    missingCount:missingKeys.length,
    pantryUsedCount:pantryUsed.length,
    score, pantryScore,
    canMakeNow:pantry.length>0 && missingKeys.length===0
  };
}
function getSuggestedRecipe() {
  if (!inventory.length) return allRecipes()[0] || null;
  return rankRecipes().find(x => x.matched.length > 0)?.recipe || null;
}
function renderSuggestion() {
  const r = getSuggestedRecipe();
  const bar = $(".suggestion-bar");
  if (!r) {
    if ($("#suggestionTitle")) $("#suggestionTitle").textContent = "Add ingredients to get a suggestion";
    if ($("#suggestionText")) $("#suggestionText").textContent = "PantryPal will prioritize recipes you can make with what you have.";
    bar?.querySelector(".suggestion-photo")?.remove();
    return;
  }

  const m = recipeMatch(r);
  if ($("#suggestionTitle")) $("#suggestionTitle").textContent = r.name;
  if ($("#suggestionText")) $("#suggestionText").textContent = inventory.length
    ? `${m.score}% match from what you already have. You have ${m.matched.length} of ${r.ingredients.length} ingredients.`
    : r.summary;

  if (bar) {
    let photo = bar.querySelector(".suggestion-photo");
    if (!photo) {
      photo = document.createElement("div");
      photo.className = "suggestion-photo";
      bar.insertBefore(photo, bar.firstChild);
    }
    photo.innerHTML = recipeImageTag(r,'loading="lazy"');
    hydrateRecipeImages(photo);
  }
}
function bindQuickSearches() { document.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => { if ($("#recipeSearch")) $("#recipeSearch").value=b.dataset.quick; recipeVisibleLimit=48; renderRecipeLibrary(); })); }
let recipeVisibleLimit = 48;
function resetRecipeLibraryAndRender(){ recipeVisibleLimit = 48; renderRecipeLibrary(); }
function renderRecipeLibrary() {
  if(!$("#recipeGrid")) return;

  const query=clean($("#recipeSearch")?.value);
  const category=$("#categoryFilter")?.value||"all";
  const collection=$("#collectionFilter")?.value||"all";
  const maxMissing=maxMissingFromValue($("#maxMissingFilter")?.value);
  const sort=$("#recipeSort")?.value||"best";

  let rows=allRecipes().map(recipeMatch).filter(({recipe})=>{
    const text=clean([recipe.name,recipe.category,recipe.summary,...(recipe.ingredients||[])].join(" "));
    return (category==="all"||recipe.category===category)
      && recipeCollectionMatch(recipe,collection)
      && text.includes(query);
  });

  rows=filterByMissingAllowance(rows,maxMissing);

  if(sort==="best" && inventory.length) rows.sort(compareRecipeMatches);
  else if(sort==="ingredients") rows.sort((a,b)=>recipeIngredientCount(a.recipe)-recipeIngredientCount(b.recipe)||a.recipe.name.localeCompare(b.recipe.name));
  else if(sort==="budget") rows.sort((a,b)=>
    Number(isBudgetFriendlyRecipe(b.recipe))-Number(isBudgetFriendlyRecipe(a.recipe))
    || recipeIngredientCount(a.recipe)-recipeIngredientCount(b.recipe)
    || a.recipe.name.localeCompare(b.recipe.name));
  else if(sort==="time") rows.sort((a,b)=>(parseInt(a.recipe.time)||999)-(parseInt(b.recipe.time)||999));
  else rows.sort((a,b)=>a.recipe.name.localeCompare(b.recipe.name));

  if($("#emptyRecipes")){
    $("#emptyRecipes").hidden=rows.length>0;
    if(!rows.length && inventory.length && maxMissing!==Infinity){
      $("#emptyRecipes").textContent=maxMissing===0
        ?"No recipes can be made with only the ingredients you have under the current filters."
        :`No recipes need ${maxMissing} or fewer additional ingredients under the current filters.`;
    } else {
      $("#emptyRecipes").textContent="No recipes found.";
    }
  }

  const visibleRows=rows.slice(0,recipeVisibleLimit);
  $("#recipeGrid").innerHTML=visibleRows.map(x=>recipeCard(x.recipe,x)).join("");
  bindRecipeButtons($("#recipeGrid"));
  hydrateRecipeImages($("#recipeGrid"));
  ensureRecipeLoadMore(rows.length);
}
function ensureRecipeLoadMore(total){
  const grid=$("#recipeGrid"); if(!grid) return;
  let button=$("#loadMoreRecipesButton");
  if(!button){
    button=document.createElement("button"); button.id="loadMoreRecipesButton"; button.className="load-more-recipes"; button.type="button";
    button.addEventListener("click",()=>{ recipeVisibleLimit += 48; renderRecipeLibrary(); });
    grid.insertAdjacentElement("afterend",button);
  }
  button.hidden = total <= recipeVisibleLimit;
  button.textContent = `Show more recipes (${Math.min(recipeVisibleLimit,total)} of ${total})`;
}
function recipeImageAuditState(recipe){
  if(String(recipe?.photo||"").trim()) return "source-image";
  return "verified-search";
}

function recipeCard(recipe,match=recipeMatch(recipe)){
  const favorite=favorites.includes(recipe.id);
  const badges=recipeCollectionBadges(recipe);
  return `<article class="recipe-card">
    <div class="recipe-image">${recipeImageTag(recipe,'loading="lazy"')}</div>
    <div class="recipe-body">
      <div class="recipe-meta">
        <span>${escapeHTML(recipe.time||"Flexible")}</span>
        <span>${recipe.servings||2} servings</span>
        <span>${recipeIngredientCount(recipe)} ingredients</span>
      </div>
      <h3>${escapeHTML(recipe.name)}</h3>
      <p>${escapeHTML(recipe.summary||"Saved recipe")}</p>
      ${badges.length?`<div class="recipe-budget-badges">${badges.map(b=>`<span>${escapeHTML(b)}</span>`).join("")}</div>`:""}
      ${inventory.length?`<small class="match-pill ${match.canMakeNow?"ready-now":""}">${match.canMakeNow
        ?`Make now • uses ${match.pantryUsedCount} of yours`
        :`${match.score}% match • ${match.missingCount} to buy`}</small>`:""}
      <div class="recipe-actions">
        <button class="icon-button ${favorite?"active":""}" type="button" data-favorite="${recipe.id}" aria-label="${favorite?"Remove favorite":"Save favorite"}">${favorite?"♥":"♡"}</button>
        <button class="text-button" type="button" data-plan="${recipe.id}">Plan</button>
        <button class="text-button" type="button" data-open="${recipe.id}">View</button>
      </div>
    </div>
  </article>`;
}
function bindRecipeButtons(container) {
  if (!container) return;
  container.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openRecipe(b.dataset.open)));
  container.querySelectorAll("[data-plan]").forEach(b=>b.addEventListener("click",()=>{addRecipeToNextOpenSlot(b.dataset.plan);location.href="planner.html";}));
  container.querySelectorAll("[data-favorite]").forEach(b=>b.addEventListener("click",()=>toggleFavorite(b.dataset.favorite)));
}

function openRecipe(id) {
  const recipe=findRecipe(id); if (!recipe || !$("#recipeDialog")) return;
  rememberRecentRecipe(id);
  ensureDialogExtras(); activeRecipeId=id; dialogServingTarget=recipe.servings||2;
  $("#dialogMeta").textContent=`${recipe.category||"Recipe"} • ${recipe.time||"Flexible"}`;
  if ($("#dialogImage")) {
    const dialogImage = $("#dialogImage");
    dialogImage.src=recipePhoto(recipe);
    dialogImage.dataset.fallback=recipeFallback(recipe);
    dialogImage.dataset.recipePhotoId=recipe.id;
    dialogImage.alt=recipe.name;
    hydrateRecipeImageElement(dialogImage);
  }
  $("#dialogTitle").textContent=recipe.name; $("#dialogSummary").textContent=recipe.summary||recipe.notes||"";
  renderDialogRecipe(recipe); updateDialogFavoriteButton(); updateDialogPhotoCredit(recipe.id); $("#recipeDialog").showModal();
}
function renderDialogRecipe(recipe) {
  const base=recipe.servings||2, ratio=dialogServingTarget/base;
  if ($("#dialogServings")) $("#dialogServings").textContent=`${dialogServingTarget} servings`;
  const displayIngredients=(recipe.ingredientDetails?.length?recipe.ingredientDetails:recipe.ingredients);
  $("#dialogIngredients").innerHTML=displayIngredients.map(x=>`<li>${escapeHTML(scaleIngredient(x,ratio))}</li>`).join("");
  const steps=parseInstructions(recipe.instructions); if ($("#dialogInstructionsList")) $("#dialogInstructionsList").innerHTML=steps.map(s=>`<li>${escapeHTML(s)}</li>`).join("");
}
function changeDialogServings(delta) { const r=findRecipe(activeRecipeId); if (!r) return; dialogServingTarget=Math.max(1,(dialogServingTarget||r.servings||2)+delta); renderDialogRecipe(r); }
function scaleIngredient(text, ratio) { return String(text).replace(/^\s*(\d+(?:\.\d+)?|\d+\/\d+)\b/, m => { let n=m.includes("/") ? m.split("/").reduce((a,b)=>Number(a)/Number(b)) : Number(m); const v=Math.round(n*ratio*100)/100; return String(v); }); }
function parseInstructions(text) { const lines=String(text||"").split(/\n+/).map(s=>s.trim()).filter(Boolean); return lines.length>1 ? lines : String(text||"").split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean); }
function updateDialogFavoriteButton() { if ($("#dialogFavoriteButton")&&activeRecipeId) $("#dialogFavoriteButton").textContent=favorites.includes(activeRecipeId)?"Remove favorite":"Save favorite"; }
function toggleFavorite(id) { favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id]; save(STORE.favorites,favorites); updateStats(); renderFavorites(); renderRecipeLibrary(); updateDialogFavoriteButton(); }
function buildFavoriteCategory() { const s=$("#favoriteCategory"); if (!s||s.dataset.ready) return; [...new Set(allRecipes().map(r=>r.category))].sort().forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;s.appendChild(o)}); s.dataset.ready="1"; }
function renderFavorites() {
  if (!$("#favoriteRecipes")) return;
  const q=clean($("#favoriteSearch")?.value), c=$("#favoriteCategory")?.value||"all";
  const items=favorites.map(findRecipe).filter(Boolean).filter(r=>(c==="all"||r.category===c)&&clean(`${r.name} ${r.category} ${favoriteNotes[r.id]||""}`).includes(q));
  if ($("#favoritesEmpty")) $("#favoritesEmpty").hidden=items.length>0;
  $("#favoriteRecipes").innerHTML=items.map(r=>`<article class="recipe-card"><div class="recipe-image">${recipeImageTag(r)}</div><div class="recipe-body"><h3>${escapeHTML(r.name)}</h3><small>${escapeHTML(r.category||"Recipe")}</small><textarea class="favorite-note" data-favorite-note="${r.id}" placeholder="Add a note...">${escapeHTML(favoriteNotes[r.id]||"")}</textarea><div class="recipe-actions"><button class="icon-button active" data-favorite="${r.id}" type="button">♥</button><button class="text-button" data-plan="${r.id}" type="button">Plan</button><button class="text-button" data-open="${r.id}" type="button">View</button></div></div></article>`).join("");
  bindRecipeButtons($("#favoriteRecipes")); hydrateRecipeImages($("#favoriteRecipes")); document.querySelectorAll("[data-favorite-note]").forEach(t=>t.addEventListener("change",()=>{favoriteNotes[t.dataset.favoriteNote]=t.value;save(STORE.favoriteNotes,favoriteNotes)}));
}

function normalizePlan(raw) {
  if (!raw || typeof raw!=="object") return {};
  const keys=Object.keys(raw); if (!keys.some(k=>k.includes("-")&&k.length>10)) return raw;
  const converted={}; const start=startOfWeek(new Date());
  keys.forEach(k=>{ const [day,meal]=k.split("-"); const dayIndex=["SUN","MON","TUE","WED","THU","FRI","SAT"].indexOf(day); if(dayIndex>=0){const d=new Date(start);d.setDate(start.getDate()+dayIndex); converted[slotKey(d,meal)]=raw[k];}}); return converted;
}
function persistPlannerState(){ save(STORE.plannerView,plannerView); save(STORE.plannerDate,isoDate(plannerDate)); }
function shiftPlanner(direction){ if(plannerView==="month") plannerDate.setMonth(plannerDate.getMonth()+direction); else plannerDate.setDate(plannerDate.getDate()+7*direction); persistPlannerState(); renderPlanner(); }
function renderPlanner(){ renderWeekGrid(); renderMonthGrid(); updatePlannerToolbar(); renderSuggestion(); }
function updatePlannerToolbar(){ if($("#mealGrid")) $("#mealGrid").hidden=plannerView!=="week"; if($("#monthGrid")) $("#monthGrid").hidden=plannerView!=="month"; $("#weekViewButton")?.classList.toggle("soft-button",plannerView!=="week"); $("#monthViewButton")?.classList.toggle("soft-button",plannerView!=="month"); if($("#plannerRangeLabel")) $("#plannerRangeLabel").textContent=plannerView==="week"?weekLabel(plannerDate):plannerDate.toLocaleDateString(undefined,{month:"long",year:"numeric"}); }

function renderHomeDashboard() {
  const matches = inventory.length ? rankRecipes().filter(x => x.matched.length > 0) : [];
  const planned = Object.values(plan).filter(Boolean);
  const today = new Date();
  const todayKey = isoDate(today);

  if ($("#homeIngredientCount")) $("#homeIngredientCount").textContent = inventory.length;
  if ($("#homeMatchCount")) $("#homeMatchCount").textContent = matches.length;
  if ($("#homeFavoriteCount")) $("#homeFavoriteCount").textContent = favorites.length;
  if ($("#homePlannedCount")) $("#homePlannedCount").textContent = planned.length;

  const best = matches[0];
  if ($("#homeBestMatch")) {
    $("#homeBestMatch").innerHTML = best ? `<article class="home-best-card">
      ${recipeImageTag(best.recipe, 'loading="lazy"')}
      <div>
        <span class="home-match-badge">${best.score}% match</span>
        <h3>${escapeHTML(best.recipe.name)}</h3>
        <p>${best.missing.length ? `${best.missing.length} ingredient${best.missing.length===1?"":"s"} still needed` : "You already have everything this recipe needs."}</p>
        <button type="button" data-home-open="${best.recipe.id}">View recipe</button>
      </div>
    </article>` : `<div class="home-empty">Add ingredients to your kitchen and PantryPal will put your best recipe match here.</div>`;
  }

  if ($("#homeTodayPlan")) {
    const dayRows = MEALS.map(meal => {
      const recipe = findRecipe(plan[`${todayKey}|${meal.key}`]);
      return `<div class="home-list-item home-plan-item">
        ${recipe ? `<div class="home-plan-thumb">${recipeImageTag(recipe,'loading="lazy"')}</div>` : `<div class="home-plan-empty-icon" aria-hidden="true">${meal.icon}</div>`}
        <div class="home-plan-copy"><strong>${meal.key}</strong><small>${recipe ? escapeHTML(recipe.name) : "Nothing planned yet"}</small></div>
        ${recipe ? `<button type="button" data-home-open="${recipe.id}">View</button>` : ""}
      </div>`;
    });
    $("#homeTodayPlan").innerHTML = dayRows.join("");
  }

  if ($("#homeRecommendations")) {
    let recs = matches.slice(0,4);
    if (!inventory.length) recs = allRecipes().slice(0,4).map(recipeMatch);
    $("#homeRecommendations").innerHTML = recs.map(homeRecipeCard).join("") || `<div class="home-empty">Add ingredients to see recommendations based on what you already have.</div>`;
  }

  if ($("#homePantrySnapshot")) {
    if (!inventory.length) $("#homePantrySnapshot").innerHTML = `<div class="home-empty">Your kitchen inventory is empty. Add ingredients to start matching recipes.</div>`;
    else {
      const counts = {};
      inventory.forEach(i => counts[i.category || "Other"] = (counts[i.category || "Other"] || 0) + 1);
      $("#homePantrySnapshot").innerHTML = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([category,count]) => `<div class="home-list-item"><strong>${escapeHTML(category)}</strong><small>${count} item${count===1?"":"s"}</small></div>`).join("");
    }
  }

  if ($("#homeGroceryPreview")) {
    const items = typeof generatedGroceryItems === "function" ? generatedGroceryItems().filter(i => !groceryChecked[i.id]).slice(0,5) : [];
    $("#homeGroceryPreview").innerHTML = items.length ? items.map(i => `<div class="home-list-item"><strong>${escapeHTML(titleCase(i.name))}</strong><small>${i.count>1 ? `${i.count} needed` : "Needed"}</small></div>`).join("") : `<div class="home-empty">${planned.length ? "Your planned meals do not need anything else right now." : "Plan meals and missing ingredients will appear here."}</div>`;
  }

  renderHomeRecent();
  hydrateRecipeImages($("#homeBestMatch") || document);
  hydrateRecipeImages($("#homeTodayPlan") || document);
  hydrateRecipeImages($("#homeRecommendations") || document);
  document.querySelectorAll("[data-home-open]").forEach(b => b.addEventListener("click", () => openRecipe(b.dataset.homeOpen)));
}

function renderHomeRecent() {
  if (!$("#homeRecentRecipes")) return;
  const recent = load(STORE.recentRecipes, []).map(findRecipe).filter(Boolean).slice(0,4);
  const section = $("#recentlyViewedSection");
  if (!recent.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  $("#homeRecentRecipes").innerHTML = recent.map(r => homeRecipeCard(recipeMatch(r))).join("");
  hydrateRecipeImages($("#homeRecentRecipes")); $("#homeRecentRecipes").querySelectorAll("[data-home-open]").forEach(b => b.addEventListener("click", () => openRecipe(b.dataset.homeOpen)));
}

function homeRecipeCard(match) {
  const recipe = match.recipe;
  return `<article class="home-mini-recipe">
    ${recipeImageTag(recipe, 'loading="lazy"')}
    <div><h3>${escapeHTML(recipe.name)}</h3><small>${inventory.length ? `${match.score}% match • ${match.missing.length} missing` : escapeHTML(recipe.category || "Recipe")}</small><button type="button" data-home-open="${recipe.id}">View recipe</button></div>
  </article>`;
}

function findRecipe(id){return allRecipes().find(r=>r.id===id)||null;}
function ingredientMatches(a,b){return ingredientKeysMatch(ingredientKey(a),ingredientKey(b));}
function canonicalIngredientAlias(s){
  const aliases={
    "scallion":"green onion","scallions":"green onion",
    "spring onion":"green onion","spring onions":"green onion","green onions":"green onion",
    "garbanzo bean":"chickpea","garbanzo beans":"chickpea","garbanzo":"chickpea","chick peas":"chickpea",
    "cilantro":"coriander",
    "capsicum":"bell pepper","capsicums":"bell pepper",
    "sweet pepper":"bell pepper","sweet peppers":"bell pepper","bell peppers":"bell pepper",
    "aubergine":"eggplant","courgette":"zucchini",
    "minced beef":"ground beef","beef mince":"ground beef",
    "confectioner sugar":"powdered sugar","confectioners sugar":"powdered sugar","icing sugar":"powdered sugar",
    "caster sugar":"granulated sugar","superfine sugar":"granulated sugar",
    "plain flour":"all-purpose flour","all purpose flour":"all-purpose flour",
    "yoghurt":"yogurt","greek yoghurt":"greek yogurt",
    "red apple":"apple","green apple":"apple","granny smith apple":"apple",
    "red apples":"apple","green apples":"apple","granny smith apples":"apple",
    "tomatoes":"tomato","potatoes":"potato","eggs":"egg","apples":"apple",
    "chillies":"chili","chilies":"chili","chilli":"chili",
    "onions":"onion","carrots":"carrot","bananas":"banana",
    "strawberries":"strawberry","blueberries":"blueberry","raspberries":"raspberry",
    "black beans":"black bean","kidney beans":"kidney bean","pinto beans":"pinto bean",
    "chickpeas":"chickpea","lentils":"lentil",
    "tortillas":"tortilla","noodles":"noodle","oats":"oat",
    "canned tomatoes":"canned tomato","tinned tomatoes":"canned tomato",
    "mixed vegetables":"mixed vegetable","frozen vegetables":"frozen vegetable"
  };
  return aliases[s] || s;
}
function ingredientKeysMatch(a,b){
  a=canonicalIngredientAlias(a); b=canonicalIngredientAlias(b);
  if(!a||!b) return false;
  if(a===b) return true;
  const at=a.split(/\s+/).filter(Boolean), bt=b.split(/\s+/).filter(Boolean);
  const allIn=(small,big)=>small.every(token=>big.includes(token));
  return allIn(at,bt) || allIn(bt,at);
}
function ingredientKey(value){
  let s=clean(value)
    .normalize("NFKD")
    .replace(/[’‘`]/g,"'")
    .replace(/[–—]/g,"-")
    .replace(/\b([a-z]+)'s\b/g,"$1")
    .replace(/^\d+(?:\.\d+)?(?:\/\d+)?\s*/,"")
    .replace(/^(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|milliliters?|liters?|l|cans?|packages?|cloves?|slices?|pinches?|dash(?:es)?|pieces?|bunches?)\s+/i,"")
    .replace(/\b(fresh|frozen|diced|chopped|minced|shredded|grated|sliced|large|small|medium|ripe|cooked|uncooked|raw|whole|halved|peeled|optional)\b/g,"")
    .replace(/[-_/]+/g," ")
    .replace(/[.,;:()[\]{}]/g," ")
    .replace(/\s+/g," ")
    .trim();
  s=singularize(s);
  return canonicalIngredientAlias(s);
}
function singularize(s){
  const keep=new Set(["cheese","rice","lettuce","couscous","hummus","molasses","asparagus","citrus","watercress"]);
  const irregular={
    "apples":"apple","potatoes":"potato","tomatoes":"tomato","loaves":"loaf","leaves":"leaf",
    "knives":"knife","halves":"half","berries":"berry","cherries":"cherry"
  };
  return s.split(" ").map(w=>{
    if(keep.has(w)) return w;
    if(irregular[w]) return irregular[w];
    if(w.endsWith("ies")&&w.length>4) return w.slice(0,-3)+"y";
    if(w.endsWith("oes")&&w.length>4) return w.slice(0,-2);
    if(/(ches|shes|xes|zes|sses)$/.test(w)&&w.length>4) return w.slice(0,-2);
    if(w.endsWith("s")&&!/(ss|us|is|ous)$/.test(w)&&w.length>3) return w.slice(0,-1);
    return w;
  }).join(" ");
}
function stripQuantity(s){return String(s).replace(/^\s*\d+(?:\.\d+)?(?:\/\d+)?\s*/,"").trim();}
function groceryCategory(name){const s=clean(name);if(/milk|cheese|yogurt|butter|cream|egg/.test(s))return"Dairy & Eggs";if(/chicken|beef|pork|fish|salmon|shrimp|turkey|meat/.test(s))return"Meat & Seafood";if(/tomato|pepper|spinach|lettuce|onion|garlic|carrot|avocado|banana|apple|berry|berries|lime|lemon|produce/.test(s))return"Produce";if(/bread|tortilla|bun|roll/.test(s))return"Bakery";if(/frozen/.test(s))return"Frozen";return"Pantry";}
function recipeFallback(recipe){
  const category=clean(recipe?.category||"recipe");
  const map={breakfast:"breakfast",lunch:"lunch",dinner:"dinner",soup:"soup",side:"side",snack:"snack",salad:"side",pasta:"dinner",seafood:"dinner",vegetarian:"dinner",dessert:"snack"};
  return `assets/recipe-images/${map[category]||"recipe"}.svg`;
}
function recipePhoto(recipe){
  const explicit = String(recipe?.photo || "").trim();
  if (explicit && !/loremflickr\.com|picsum\.photos/i.test(explicit)) return explicit;
  return recipeFallback(recipe);
}
function recipeImageTag(recipe,extra=""){
  const direct=Boolean(String(recipe?.photo||"").trim());
  return `<img src="${escapeHTML(recipePhoto(recipe))}" data-fallback="${escapeHTML(recipeFallback(recipe))}" data-recipe-photo-id="${escapeHTML(recipe?.id||"")}" data-resolved-photo="${direct?"1":"0"}" referrerpolicy="no-referrer" alt="${escapeHTML(recipe?.name||"Recipe")}" ${extra}>`;
}
async function handleRecipeImageError(event){
  const img=event.target;
  if(!img || img.tagName!=="IMG" || !img.dataset?.fallback) return;

  const recipeId=img.dataset.recipePhotoId;
  const failedUrl=img.currentSrc||img.src||"";
  if(failedUrl) rejectedRecipePhotoUrls.add(failedUrl);

  const cached=recipeId ? await getCachedRecipePhoto(recipeId) : null;
  const alternates=(cached?.alternates||[]).filter(url=>url && !rejectedRecipePhotoUrls.has(url));
  for(const alt of alternates){
    if(await verifyRecipePhotoUrl(alt)){
      cached.thumbnail=alt;
      cached.original=alt;
      cached.alternates=alternates.filter(x=>x!==alt);
      await cacheRecipePhoto(cached);
      img.dataset.resolvedPhoto="1";
      img.src=alt;
      return;
    }
  }

  img.dataset.resolvedPhoto="0";
  if(!img.src.endsWith(img.dataset.fallback)) img.src=img.dataset.fallback;

  if(recipeId && img.dataset.photoRetry!=="1"){
    img.dataset.photoRetry="1";
    await forgetRecipePhoto(recipeId);
    try{
      const photo=await resolveLicensedRecipePhoto(recipeId);
      if(photo?.thumbnail && document.contains(img)){
        img.dataset.resolvedPhoto="1";
        img.src=photo.thumbnail;
      }
    }finally{
      img.dataset.photoRetry="0";
    }
  }
}
function startOfWeek(date){const d=new Date(date);d.setHours(12,0,0,0);d.setDate(d.getDate()-d.getDay());return d;}
function isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function slotKey(d,meal){return `${isoDate(d)}|${meal}`;}
function splitSlotKey(k){const i=k.indexOf("|");return [k.slice(0,i),k.slice(i+1)];}
function dateFromSlotKey(k){const [d]=splitSlotKey(k);const x=new Date(d+"T12:00:00");return isNaN(x)?null:x;}
function weekLabel(date){const s=startOfWeek(date),e=new Date(s);e.setDate(s.getDate()+6);return `${s.toLocaleDateString(undefined,{month:"short",day:"numeric"})} – ${e.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;}
function titleCase(value){return String(value).replace(/\b\w/g,c=>c.toUpperCase());}
function clean(value){return String(value||"").trim().toLowerCase().replace(/\s+/g," ");}
function uid(){return `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;}
function storageKey(key){ return window.PantryPalAuth?.scopedKey ? window.PantryPalAuth.scopedKey(key) : key; }
function load(key,fallback){try{const scoped=localStorage.getItem(storageKey(key)); if(scoped!==null) return JSON.parse(scoped); const legacy=localStorage.getItem(key); return legacy!==null?JSON.parse(legacy):fallback}catch{return fallback}}
function save(key,value){localStorage.setItem(storageKey(key),JSON.stringify(value));}
function downloadJSON(name,data){downloadText(name,JSON.stringify(data,null,2),"application/json");}
function downloadText(name,text,type="text/plain"){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function announce(text){let el=$("#liveRegion");if(!el){el=document.createElement("div");el.id="liveRegion";el.className="sr-only";el.setAttribute("aria-live","polite");document.body.appendChild(el);}el.textContent=text;}

/* App bootstraps after the entire script has initialized. */


const BUDGET_STAPLE_KEYS=new Set([
  "rice","bean","black bean","kidney bean","pinto bean","chickpea","lentil",
  "pasta","spaghetti","macaroni","noodle","ramen","potato","sweet potato","egg",
  "oat","oatmeal","bread","tortilla","flour","cornmeal","corn","pea","carrot",
  "onion","garlic","tomato","tuna","peanut butter","banana","apple","milk",
  "cheese","yogurt","cabbage","frozen vegetable","mixed vegetable","broth"
]);
const PREMIUM_BUDGET_EXCLUSIONS=/\b(lobster|crab|filet mignon|tenderloin|ribeye|prime rib|lamb chop|scallop|prosciutto|truffle|saffron)\b/i;

function recipeIngredientKeys(recipe){
  return [...new Set((recipe?.ingredients||[]).map(ingredientKey).filter(Boolean))];
}
function recipeIngredientCount(recipe){ return recipeIngredientKeys(recipe).length; }
function isFiveIngredientRecipe(recipe){ return recipeIngredientCount(recipe)<=5; }
function isThreeIngredientRecipe(recipe){ return recipeIngredientCount(recipe)<=3; }
function budgetStapleHits(recipe){
  return recipeIngredientKeys(recipe).filter(key =>
    BUDGET_STAPLE_KEYS.has(key) ||
    [...BUDGET_STAPLE_KEYS].some(staple=>ingredientKeysMatch(key,staple))
  ).length;
}
function isBudgetFriendlyRecipe(recipe){
  const count=recipeIngredientCount(recipe);
  const text=`${recipe?.name||""} ${(recipe?.ingredients||[]).join(" ")}`;
  if(PREMIUM_BUDGET_EXCLUSIONS.test(text)) return false;
  const hits=budgetStapleHits(recipe);
  return count<=5 || (count<=7&&hits>=2) || (count<=9&&hits>=4);
}
function isPantryStapleRecipe(recipe){
  const count=recipeIngredientCount(recipe);
  return count<=8 && budgetStapleHits(recipe)>=Math.min(3,Math.max(1,Math.floor(count/2)));
}
function recipeCollectionMatch(recipe,collection){
  if(collection==="budget") return isBudgetFriendlyRecipe(recipe);
  if(collection==="five") return isFiveIngredientRecipe(recipe);
  if(collection==="three") return isThreeIngredientRecipe(recipe);
  if(collection==="pantry") return isPantryStapleRecipe(recipe);
  return true;
}
function recipeCollectionBadges(recipe){
  const badges=[];
  if(isThreeIngredientRecipe(recipe)) badges.push("3 ingredients");
  else if(isFiveIngredientRecipe(recipe)) badges.push("5 ingredients or less");
  if(isBudgetFriendlyRecipe(recipe)) badges.push("Budget-friendly");
  return badges;
}
function maxMissingFromValue(value){
  if(value===undefined || value===null || value==="" || value==="any") return Infinity;
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,n):Infinity;
}
function currentMaxMissing(){
  const el=$("#matchMissingFilter")||$("#maxMissingFilter");
  return maxMissingFromValue(el?.value);
}
function compareRecipeMatches(a,b){
  // 1) Recipes requiring nothing new.
  if(a.canMakeNow!==b.canMakeNow) return Number(b.canMakeNow)-Number(a.canMakeNow);
  // 2) Use as much of the user's existing food as possible.
  if(a.pantryUsedCount!==b.pantryUsedCount) return b.pantryUsedCount-a.pantryUsedCount;
  if(a.pantryScore!==b.pantryScore) return b.pantryScore-a.pantryScore;
  // 3) Then minimize anything the user still has to buy.
  if(a.missingCount!==b.missingCount) return a.missingCount-b.missingCount;
  if(a.score!==b.score) return b.score-a.score;
  return a.recipe.name.localeCompare(b.recipe.name);
}
function filterByMissingAllowance(rows,maxMissing=currentMaxMissing()){
  if(!inventory.length || maxMissing===Infinity) return rows;
  return rows.filter(row=>row.missingCount<=maxMissing);
}

/* -------------------------------------------------------------------------
   Pantry-first recipe discovery
   PantryPal always ranks recipes the user can make now before partial matches.
   If the built-in database has no complete match, the Ingredients page
   automatically checks public recipe sources and ranks those by overlap.
   ------------------------------------------------------------------------- */
let autoOnlineSearchTimer = null;
let lastAutoOnlineSignature = "";

function rankRecipes() {
  return allRecipes().map(recipeMatch).sort(compareRecipeMatches);
}

function renderMatches() {
  if(!$("#recipeMatches")) return;
  const pantry=ingredientNames();
  const maxMissing=maxMissingFromValue($("#matchMissingFilter")?.value);
  const ranked=filterByMissingAllowance(rankRecipes().filter(x=>x.matchedCount>0),maxMissing);
  const ready=ranked.filter(x=>x.canMakeNow);
  const display=ranked.slice(0,16);

  if(!pantry.length){
    $("#recipeMatches").innerHTML='<p class="empty-message">Add ingredients to see recipes based on what you already have.</p>';
    if($("#onlineStatus")) $("#onlineStatus").textContent="Add ingredients and PantryPal will search automatically if needed.";
    return;
  }

  $("#recipeMatches").innerHTML=display.length
    ? display.map(({recipe,matchedCount,missingCount,score,pantryUsedCount,canMakeNow})=>`
      <article class="match-card">
        <div class="food-thumb">${recipeImageTag(recipe,'loading="lazy"')}</div>
        <div>
          <h3>${escapeHTML(recipe.name)}</h3>
          <small>${canMakeNow
            ? `Ready to make • uses ${pantryUsedCount} of your ingredient${pantryUsedCount===1?"":"s"}`
            : `${score}% recipe match • uses ${matchedCount} • ${missingCount} ingredient${missingCount===1?"":"s"} to buy`}
          </small>
          ${recipeCollectionBadges(recipe).length?`<div class="recipe-budget-badges compact">${recipeCollectionBadges(recipe).map(b=>`<span>${escapeHTML(b)}</span>`).join("")}</div>`:""}
        </div>
        <button class="match-pill" type="button" data-open="${recipe.id}">${canMakeNow?"Make this":"View"}</button>
      </article>`).join("")
    : `<p class="empty-message">${maxMissing===0
      ?"No recipe in the built-in collection can be made entirely from those ingredients yet. PantryPal is checking outside sources."
      :`No built-in recipes fit your limit of ${maxMissing} additional ingredient${maxMissing===1?"":"s"}. PantryPal is checking outside sources.`}</p>`;

  bindRecipeButtons($("#recipeMatches"));
  hydrateRecipeImages($("#recipeMatches"));

  if(!display.length || !ready.length) queueAutomaticOnlineSearch();
  else if($("#onlineStatus") && !$("#onlineResults")?.children.length){
    $("#onlineStatus").textContent=`${ready.length} recipe${ready.length===1?"":"s"} can be made without buying anything else.`;
  }
}

function queueAutomaticOnlineSearch() {
  if (!$("#onlineResults") || !ingredientNames().length) return;
  const signature = ingredientNames().map(clean).sort().join("|");
  if (!signature || signature === lastAutoOnlineSignature) return;
  clearTimeout(autoOnlineSearchTimer);
  autoOnlineSearchTimer = setTimeout(() => {
    lastAutoOnlineSignature = signature;
    searchOnline(true);
  }, 450);
}

async function searchOnline(automatic = false) {
  updateOnlineLinks();
  const items = ingredientNames();
  if (!items.length) {
    if ($("#onlineStatus")) $("#onlineStatus").textContent = "Add ingredients first so PantryPal can search from what you already have.";
    return;
  }
  const button = $("#onlineSearchButton");
  if (button) button.disabled = true;
  if ($("#onlineStatus")) $("#onlineStatus").textContent = automatic
    ? "No complete built-in match yet. Checking other recipe sources automatically..."
    : "Searching recipe sources using the ingredients you already have...";
  if ($("#onlineResults")) $("#onlineResults").innerHTML = "";

  try {
    const [mealDb, forkify] = await Promise.allSettled([
      fetchOnlineMeals(items),
      fetchForkifyMeals(items)
    ]);
    const combined = new Map();
    const addRows = rows => (rows || []).forEach(row => {
      const key = clean(row.name);
      const old = combined.get(key);
      if (!old || row.matched.length > old.matched.length) combined.set(key, row);
    });
    const maxMissing=maxMissingFromValue($("#matchMissingFilter")?.value);
    if(mealDb.status==="fulfilled") addRows((mealDb.value||[]).filter(r=>maxMissing===Infinity||r.missingCount<=maxMissing));
    if(forkify.status==="fulfilled" && maxMissing===Infinity) addRows(forkify.value);
    const results=[...combined.values()].sort((a,b)=>{
      const aReady=Number((a.missingCount??Infinity)===0);
      const bReady=Number((b.missingCount??Infinity)===0);
      return bReady-aReady
        || (a.missingCount??Infinity)-(b.missingCount??Infinity)
        || b.matched.length-a.matched.length
        || a.name.localeCompare(b.name);
    });

    if (!results.length) {
      renderOnlineFallback("The live recipe APIs did not return a direct match, so PantryPal built broader recipe searches from your ingredients.");
      return;
    }

    if ($("#onlineStatus")) $("#onlineStatus").textContent = `Found ${results.length} outside recipe idea${results.length === 1 ? "" : "s"}, ranked by how many of your ingredients they use.`;
    if ($("#onlineResults")) $("#onlineResults").innerHTML = results.slice(0, 16).map(r => `
      <article class="online-card">
        <div class="food-thumb">${r.image ? `<img src="${escapeHTML(r.image)}" alt="" loading="lazy">` : "🍽️"}</div>
        <div>
          <h3>${escapeHTML(r.name)}</h3>
          <small>${escapeHTML(r.source||"Online recipe")} • ${r.missingCount===0
            ?"can be made with what you have"
            :`${r.matchScore?`${r.matchScore}% ingredient overlap • `:""}uses ${r.matched.length} of yours${Number.isFinite(r.missingCount)?` • ${r.missingCount} to buy`:""}`}</small>
        </div>
        <a class="match-pill" href="${escapeHTML(r.url)}" target="_blank" rel="noopener noreferrer">Open</a>
      </article>`).join("");
  } catch {
    renderOnlineFallback("Live recipe lookup did not respond, so PantryPal prepared broader web searches from your ingredients.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function fetchOnlineMeals(items) {
  const candidateIds=new Map();
  const terms=items.slice(0,10);
  await Promise.all(terms.map(async ingredient=>{
    try{
      const response=await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`);
      if(!response.ok) return;
      const data=await response.json();
      for(const meal of (Array.isArray(data.meals)?data.meals:[]).slice(0,30)){
        const row=candidateIds.get(meal.idMeal)||{id:meal.idMeal,name:meal.strMeal,image:meal.strMealThumb,queries:new Set()};
        row.queries.add(ingredient); candidateIds.set(meal.idMeal,row);
      }
    }catch{}
  }));

  const candidates=[...candidateIds.values()].slice(0,60);
  const details=[];
  for(let i=0;i<candidates.length;i+=8){
    const batch=candidates.slice(i,i+8);
    const rows=await Promise.all(batch.map(async c=>{
      try{
        const response=await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(c.id)}`);
        if(!response.ok) return null;
        const data=await response.json();
        const meal=Array.isArray(data.meals)?data.meals[0]:null;
        if(!meal) return null;
        const mealIngredients=mealDbIngredients(meal).map(x=>x.name);
        const matched=items.filter(have=>mealIngredients.some(need=>ingredientMatches(have,need)));
        if(!matched.length) return null;
        const missing=mealIngredients.filter(need=>!items.some(have=>ingredientMatches(have,need)));
        return {
          id:meal.idMeal,name:meal.strMeal,image:meal.strMealThumb,
          url:meal.strSource||`https://www.themealdb.com/meal/${meal.idMeal}`,
          source:"TheMealDB",matched,missing,
          missingCount:[...new Set(missing.map(ingredientKey).filter(Boolean))].length,
          totalIngredients:mealIngredients.length,
          matchScore:Math.round((matched.length/Math.max(1,mealIngredients.length))*100)
        };
      }catch{return null;}
    }));
    details.push(...rows.filter(Boolean));
  }
  return details.sort((a,b)=>b.matchScore-a.matchScore||b.matched.length-a.matched.length||a.name.localeCompare(b.name));
}

async function fetchForkifyMeals(items) {
  const found = new Map();
  await Promise.all(items.slice(0, 8).map(async ingredient => {
    try {
      const response = await fetch(`https://forkify-api.herokuapp.com/api/v2/recipes?search=${encodeURIComponent(ingredient)}`);
      if (!response.ok) return;
      const data = await response.json();
      for (const recipe of (data?.data?.recipes || []).slice(0, 15)) {
        const current = found.get(recipe.id) || {
          id: recipe.id,
          name: recipe.title,
          image: recipe.image_url,
          url: `https://forkify-v2.netlify.app/#${recipe.id}`,
          source: recipe.publisher ? `Forkify • ${recipe.publisher}` : "Forkify",
          matched: []
        };
        if (!current.matched.includes(ingredient)) current.matched.push(ingredient);
        found.set(recipe.id, current);
      }
    } catch { /* ignored */ }
  }));
  return [...found.values()];
}

function renderOnlineFallback(message) {
  if ($("#onlineStatus")) $("#onlineStatus").textContent = message;
  if (!$("#onlineResults")) return;
  const ingredients = ingredientNames();
  const phrase = ingredients.join(" ");
  const q = encodeURIComponent(`${phrase} recipe`);
  const searches = [
    ["Google recipes", `https://www.google.com/search?q=${q}`],
    ["Allrecipes", `https://www.allrecipes.com/search?q=${q}`],
    ["BBC Good Food", `https://www.google.com/search?q=site%3Abbcgoodfood.com+${q}`],
    ["Food Network", `https://www.google.com/search?q=site%3Afoodnetwork.com+${q}`]
  ];
  $("#onlineResults").innerHTML = searches.map(([name,url]) => `
    <article class="online-card">
      <div class="food-thumb">🔎</div>
      <div><h3>${escapeHTML(name)}</h3><small>Search using: ${escapeHTML(ingredients.join(", "))}</small></div>
      <a class="match-pill" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Search</a>
    </article>`).join("");
}


/* -------------------------------------------------------------------------
   Licensed recipe photography
   Built-in recipe cards resolve to real, openly licensed photographs at
   runtime. Openverse is primary; Wikimedia Commons is the fallback.
   Metadata and license/source links are cached in IndexedDB and surfaced in
   the recipe dialog + Photo Credits page.
   ------------------------------------------------------------------------- */
const RECIPE_PHOTO_DB = "PantryPalRecipePhotosExactFoodComV2";
const RECIPE_PHOTO_STORE = "photos";
const RECIPE_PHOTO_VERSION = 1;
const recipePhotoMemory = new Map();
const rejectedRecipePhotoUrls = new Set();
const recipePhotoPending = new Map();
const recipePhotoQueue = [];
let recipePhotoWorkers = 0;
const RECIPE_PHOTO_CONCURRENCY = 4;
let recipePhotoObserver = null;

function openRecipePhotoDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB) return resolve(null);
    const req=indexedDB.open(RECIPE_PHOTO_DB,RECIPE_PHOTO_VERSION);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(RECIPE_PHOTO_STORE)) db.createObjectStore(RECIPE_PHOTO_STORE,{keyPath:"recipeId"}); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function getCachedRecipePhoto(recipeId){
  if(recipePhotoMemory.has(recipeId)) return recipePhotoMemory.get(recipeId);
  try{
    const db=await openRecipePhotoDB(); if(!db) return null;
    const value=await new Promise((resolve,reject)=>{ const tx=db.transaction(RECIPE_PHOTO_STORE,"readonly"); const req=tx.objectStore(RECIPE_PHOTO_STORE).get(recipeId); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error); });
    db.close(); if(value) recipePhotoMemory.set(recipeId,value); return value;
  }catch{return null;}
}
async function cacheRecipePhoto(value){
  if(!value?.recipeId) return; recipePhotoMemory.set(value.recipeId,value);
  try{ const db=await openRecipePhotoDB(); if(!db) return; await new Promise((resolve,reject)=>{ const tx=db.transaction(RECIPE_PHOTO_STORE,"readwrite"); tx.objectStore(RECIPE_PHOTO_STORE).put(value); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); }catch{}
}
async function forgetRecipePhoto(recipeId){
  recipePhotoMemory.delete(recipeId);
  try{ const db=await openRecipePhotoDB(); if(!db) return; await new Promise((resolve,reject)=>{ const tx=db.transaction(RECIPE_PHOTO_STORE,"readwrite"); tx.objectStore(RECIPE_PHOTO_STORE).delete(recipeId); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); db.close(); }catch{}
}
async function allCachedRecipePhotos(){
  try{ const db=await openRecipePhotoDB(); if(!db) return [...recipePhotoMemory.values()]; const rows=await new Promise((resolve,reject)=>{ const tx=db.transaction(RECIPE_PHOTO_STORE,"readonly"); const req=tx.objectStore(RECIPE_PHOTO_STORE).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error); }); db.close(); rows.forEach(x=>recipePhotoMemory.set(x.recipeId,x)); return rows; }catch{return [...recipePhotoMemory.values()];}
}
function startRecipePhotoHydrator(){
  if(recipePhotoObserver || !window.IntersectionObserver) { hydrateRecipeImages(document); return; }
  recipePhotoObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){ if(!entry.isIntersecting) continue; recipePhotoObserver.unobserve(entry.target); hydrateRecipeImageElement(entry.target); }
  },{rootMargin:"700px 0px"});
  observeRecipeImages(document);
  const mutation=new MutationObserver(records=>{ for(const record of records) for(const node of record.addedNodes) if(node.nodeType===1) observeRecipeImages(node); });
  mutation.observe(document.body,{childList:true,subtree:true});
}
function observeRecipeImages(root){
  const images=[];
  if(root.matches?.("img[data-recipe-photo-id]")) images.push(root);
  root.querySelectorAll?.("img[data-recipe-photo-id]").forEach(img=>images.push(img));
  images.forEach(img=>{ if(img.dataset.photoObserved==="1") return; img.dataset.photoObserved="1"; recipePhotoObserver ? recipePhotoObserver.observe(img) : hydrateRecipeImageElement(img); });
}
function hydrateRecipeImages(root=document){
  const images=[...root.querySelectorAll('img[data-recipe-photo-id]')];
  if(!images.length) return;

  const ids=[...new Set(images.map(img=>img.dataset.recipePhotoId).filter(Boolean))];

  // Start visible image resolution immediately. A slow/broken batch lookup
  // must never prevent recipe photos from appearing.
  images.forEach(img=>{
    if(img.dataset.photoObserved==="1") return;
    img.dataset.photoObserved="1";
    if(recipePhotoObserver) recipePhotoObserver.observe(img);
    else hydrateRecipeImageElement(img);
  });

  // Optional background warm-up only.
  Promise.resolve().then(()=>prefetchExactFoodComPhotos(ids)).catch(()=>{});
}
async function hydrateRecipeImageElement(img,force=false){
  const recipeId=img?.dataset?.recipePhotoId;
  if(!recipeId) return;

  const recipe=findRecipe(recipeId);
  if(!recipe) return;

  if(!force){
    const cached=await getCachedRecipePhoto(recipeId);
    if(cached?.thumbnail){
      applyRecipePhotoToAll(recipeId,cached);
      return;
    }
  }

  // This is the function that was missing in the previous build.
  // Without it the observer found images, but never started a lookup.
  enqueueRecipePhotoLookup(recipeId);
}

function enqueueRecipePhotoLookup(recipeId){
  if(recipePhotoPending.has(recipeId)) return recipePhotoPending.get(recipeId);
  let resolvePromise; const promise=new Promise(resolve=>resolvePromise=resolve); recipePhotoPending.set(recipeId,promise);
  recipePhotoQueue.push({recipeId,resolve:resolvePromise}); runRecipePhotoQueue(); return promise;
}
function runRecipePhotoQueue(){
  while(recipePhotoWorkers<RECIPE_PHOTO_CONCURRENCY && recipePhotoQueue.length){
    const job=recipePhotoQueue.shift(); recipePhotoWorkers++;
    resolveLicensedRecipePhoto(job.recipeId).then(photo=>{ if(photo) applyRecipePhotoToAll(job.recipeId,photo); job.resolve(photo); }).catch(()=>job.resolve(null)).finally(()=>{ recipePhotoPending.delete(job.recipeId); recipePhotoWorkers--; runRecipePhotoQueue(); });
  }
}

const PHOTO_FOOD_GROUPS={
  chicken:["chicken","poultry"],
  turkey:["turkey"],
  beef:["beef","steak","hamburger","burger"],
  pork:["pork","ham","bacon","sausage"],
  fish:["fish","cod","tilapia","tuna","trout"],
  salmon:["salmon"],
  shrimp:["shrimp","prawn"],
  crab:["crab"],
  lobster:["lobster"],
  egg:["egg","omelet","omelette"],
  tofu:["tofu"],
  beans:["bean","beans","chickpea","lentil"],
  pasta:["pasta","spaghetti","linguine","fettuccine","penne","macaroni","noodle"],
  rice:["rice","risotto"],
  soup:["soup","stew","chowder","bisque"],
  salad:["salad"],
  sandwich:["sandwich","sub","wrap","panini"],
  pizza:["pizza","flatbread"],
  taco:["taco","tacos","burrito","quesadilla","enchilada"],
  pancake:["pancake","waffle","crepe"],
  smoothie:["smoothie","shake"],
  cake:["cake","cupcake"],
  cookie:["cookie","cookies","biscuit"],
  bread:["bread","toast","loaf"],
  yogurt:["yogurt","yoghurt"],
  potato:["potato","potatoes","fries"],
  vegetable:["vegetable","veggie","vegetables"]
};
const PHOTO_STOP_WORDS=new Set([
  "and","with","the","a","an","of","in","on","for","to","style","easy","quick",
  "simple","classic","homemade","fresh","warm","creamy","crispy","baked","roasted",
  "grilled","fried","slow","cooker","instant","pot","one","pan","skillet","recipe",
  "dish","food","meal","best","healthy","savory","sweet"
]);

function photoTokens(value){
  return clean(value)
    .replace(/[^a-z0-9\s-]/g," ")
    .split(/\s+/)
    .map(t=>singularize(t))
    .filter(t=>t && t.length>2 && !PHOTO_STOP_WORDS.has(t));
}
function detectPhotoGroups(text){
  const hay=` ${clean(text)} `;
  return Object.entries(PHOTO_FOOD_GROUPS)
    .filter(([,terms])=>terms.some(term=>hay.includes(` ${clean(term)} `) || hay.includes(clean(term))))
    .map(([group])=>group);
}
function recipePhotoSemanticProfile(recipe){
  const name=String(recipe?.name||"");
  const ingredientNames=(recipe?.ingredients||[]).map(stripQuantity).map(clean);
  const nameTokens=[...new Set(photoTokens(name))];
  const ingredientTokens=[...new Set(ingredientNames.flatMap(photoTokens))].slice(0,14);
  const groups=[...new Set(detectPhotoGroups(`${name} ${ingredientNames.slice(0,8).join(" ")}`))];

  // The first meaningful named protein/starch/dish type is especially important.
  const priorityGroups=["chicken","turkey","beef","pork","salmon","fish","shrimp","crab","lobster","tofu","egg",
    "pasta","rice","soup","salad","sandwich","pizza","taco","pancake","smoothie","cake","cookie","bread","yogurt","potato"];
  const primaryGroup=priorityGroups.find(g=>groups.includes(g)) || groups[0] || "";

  return {nameTokens,ingredientTokens,groups,primaryGroup};
}
function photoCandidateText(candidate){
  const tags=Array.isArray(candidate?.tags) ? candidate.tags.map(t=>t?.name||t).join(" ") : "";
  const category=Array.isArray(candidate?.categories) ? candidate.categories.join(" ") : "";
  return clean(`${candidate?.title||""} ${tags} ${category} ${candidate?.description||""}`);
}
function conflictingPhotoGroup(recipeGroup,candidateGroups){
  if(!recipeGroup) return false;
  const meats=new Set(["chicken","turkey","beef","pork","salmon","fish","shrimp","crab","lobster","tofu"]);
  if(meats.has(recipeGroup)){
    return candidateGroups.some(g=>meats.has(g) && g!==recipeGroup &&
      !(recipeGroup==="fish" && g==="salmon") &&
      !(recipeGroup==="salmon" && g==="fish"));
  }
  return false;
}
function scoreRecipePhotoCandidate(candidate,recipe){
  const profile=recipePhotoSemanticProfile(recipe);
  const hay=photoCandidateText(candidate);
  const candidateTokens=new Set(photoTokens(hay));
  const candidateGroups=detectPhotoGroups(hay);

  if(conflictingPhotoGroup(profile.primaryGroup,candidateGroups)) return {accepted:false,score:-1000,reason:"conflicting-main-food"};

  let score=0;
  let nameMatches=0;
  let ingredientMatches=0;

  profile.nameTokens.forEach(token=>{
    if(candidateTokens.has(token) || hay.includes(token)){ score+=8; nameMatches++; }
  });
  profile.ingredientTokens.forEach(token=>{
    if(candidateTokens.has(token) || hay.includes(token)){ score+=2; ingredientMatches++; }
  });

  if(profile.primaryGroup && candidateGroups.includes(profile.primaryGroup)) score+=16;
  if(profile.groups.some(g=>candidateGroups.includes(g))) score+=6;

  const exactName=clean(recipe.name||"");
  const title=clean(candidate?.title||"");
  if(exactName && title.includes(exactName)) score+=30;

  // Require actual semantic evidence. A generic "food" result is not enough.
  const minimumNameMatches=Math.min(2,Math.max(1,profile.nameTokens.length));
  const groupSupported=!profile.primaryGroup || candidateGroups.includes(profile.primaryGroup);
  const accepted=
    score>=18 &&
    (nameMatches>=minimumNameMatches || (nameMatches>=1 && ingredientMatches>=2) || (groupSupported && nameMatches>=1));

  return {accepted,score,nameMatches,ingredientMatches,groupSupported,reason:accepted?"matched":"weak-match"};
}
async function verifyRecipePhotoUrl(url){
  const candidate=String(url||"").trim();
  if(!candidate || rejectedRecipePhotoUrls.has(candidate)) return false;
  return await new Promise(resolve=>{
    const probe=new Image();
    let finished=false;
    const finish=value=>{
      if(finished) return;
      finished=true;
      clearTimeout(timer);
      probe.onload=null; probe.onerror=null;
      if(!value) rejectedRecipePhotoUrls.add(candidate);
      resolve(value);
    };
    const timer=setTimeout(()=>finish(false),7000);
    probe.referrerPolicy="no-referrer";
    probe.onload=()=>finish((probe.naturalWidth||0)>=120 && (probe.naturalHeight||0)>=90);
    probe.onerror=()=>finish(false);
    probe.src=candidate;
  });
}
function rankPhotoCandidates(rows,recipe){
  return (rows||[])
    .map(row=>({row,quality:scoreRecipePhotoCandidate(row,recipe)}))
    .filter(x=>x.quality.accepted)
    .sort((a,b)=>b.quality.score-a.quality.score);
}


function mealDbIngredients(meal){
  const rows=[];
  for(let i=1;i<=20;i++){
    const name=String(meal?.[`strIngredient${i}`]||"").trim();
    const measure=String(meal?.[`strMeasure${i}`]||"").trim();
    if(name) rows.push({name,measure});
  }
  return rows;
}
function scoreTheMealDBMatch(meal,recipe){
  if(!meal||!recipe) return {accepted:false,score:0};
  const recipeNameTokens=photoTokens(recipe.name);
  const mealNameTokens=photoTokens(meal.strMeal||"");
  const mealNameSet=new Set(mealNameTokens);
  const recipeNameSet=new Set(recipeNameTokens);
  const nameHits=recipeNameTokens.filter(t=>mealNameSet.has(t)).length;
  const nameCoverage=recipeNameTokens.length?nameHits/recipeNameTokens.length:0;
  const reverseCoverage=mealNameTokens.length?mealNameTokens.filter(t=>recipeNameSet.has(t)).length/mealNameTokens.length:0;

  const recipeIng=(recipe.ingredients||[]).map(ingredientKey).filter(Boolean);
  const mealIng=mealDbIngredients(meal).map(x=>ingredientKey(x.name)).filter(Boolean);
  const ingredientHits=recipeIng.filter(r=>mealIng.some(m=>ingredientKeysMatch(r,m))).length;
  const ingredientCoverage=recipeIng.length?ingredientHits/recipeIng.length:0;

  const recipeGroups=detectPhotoGroups(`${recipe.name} ${(recipe.ingredients||[]).join(" ")}`);
  const mealGroups=detectPhotoGroups(`${meal.strMeal||""} ${mealIng.join(" ")}`);
  const primary=recipePhotoSemanticProfile(recipe).primaryGroup;
  if(conflictingPhotoGroup(primary,mealGroups)) return {accepted:false,score:-1000};

  const exact=clean(meal.strMeal||"")===clean(recipe.name||"");
  const score=(exact?80:0)+(nameCoverage*50)+(reverseCoverage*20)+(ingredientCoverage*40)+(primary&&mealGroups.includes(primary)?20:0);
  const accepted=exact || (nameCoverage>=.65 && ingredientCoverage>=.35) || (nameCoverage>=.5 && ingredientCoverage>=.55);
  return {accepted,score,nameCoverage,ingredientCoverage};
}
async function searchTheMealDBRecipePhoto(recipe){
  const queries=[recipe.name, clean(recipe.name).replace(/\b(recipe|easy|best|homemade)\b/g,"").trim()];
  for(const query of [...new Set(queries.filter(Boolean))]){
    try{
      const response=await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`);
      if(!response.ok) continue;
      const data=await response.json();
      const meals=Array.isArray(data.meals)?data.meals:[];
      const ranked=meals.map(meal=>({meal,quality:scoreTheMealDBMatch(meal,recipe)}))
        .filter(x=>x.quality.accepted && x.meal.strMealThumb)
        .sort((a,b)=>b.quality.score-a.quality.score);
      for(const {meal,quality} of ranked.slice(0,5)){
        const photoUrl=meal.strMealThumb?.endsWith('/large')?meal.strMealThumb:`${meal.strMealThumb}/large`;
        const verified=(await verifyRecipePhotoUrl(photoUrl)) || (await verifyRecipePhotoUrl(meal.strMealThumb));
        if(!verified) continue;
        const actual=(await verifyRecipePhotoUrl(photoUrl))?photoUrl:meal.strMealThumb;
        return {
          recipeId:recipe.id,
          thumbnail:actual,
          original:meal.strMealThumb,
          landingPage:meal.strSource||`https://www.themealdb.com/meal/${meal.idMeal}`,
          creator:"TheMealDB contributor",
          creatorUrl:"https://www.themealdb.com/",
          license:"TheMealDB image/source terms",
          licenseUrl:"https://www.themealdb.com/terms.php",
          provider:"TheMealDB",
          source:meal.strSource||`https://www.themealdb.com/meal/${meal.idMeal}`,
          attribution:"Recipe and image matched against TheMealDB meal data",
          query,
          matchQuality:`themealdb-${Math.round(quality.score)}`,
          mealDbId:meal.idMeal,
          resolvedAt:new Date().toISOString()
        };
      }
    }catch{}
  }
  return null;
}


const FOODCOM_HF_DATASET="untitledwebsite123/food-recipes";
const FOODCOM_HF_CONFIG="default";
const FOODCOM_HF_SPLIT="train";
const FOODCOM_HF_API="https://datasets-server.huggingface.co";
const exactFoodComNoImage=new Set();
const exactFoodComLookupPending=new Map();

function parseRVectorStrings(value){
  const text=String(value||"").trim();
  if(!text || /^character\(0\)$/i.test(text) || /^null$/i.test(text) || /^nan$/i.test(text)) return [];
  const quoted=[...text.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m=>{
    try{return JSON.parse(`"${m[1]}"`);}catch{return m[1].replace(/\\"/g,'"');}
  });
  if(quoted.length) return quoted.map(x=>String(x).trim()).filter(Boolean);
  return text.split(",").map(x=>x.trim().replace(/^['"]|['"]$/g,"")).filter(Boolean);
}

function parseRecipeImageUrls(value){
  const raw=String(value||"");
  const vector=parseRVectorStrings(raw);
  const direct=[...raw.matchAll(/https?:\/\/[^\s"',)\\]+/gi)].map(m=>m[0]);
  return [...new Set([...vector,...direct]
    .map(url=>String(url).replace(/\\u0026/g,"&").replace(/&amp;/g,"&").trim())
    .filter(url=>/^https?:\/\//i.test(url))
    .filter(url=>/img\.sndimg\.com|food\.com|cloudinary|\.jpe?g(?:$|\?)/i.test(url))
  )];
}

function parseFoodComIngredientsFromDatasetRow(row){
  return parseRVectorStrings(row?.RecipeIngredientParts||row?.ingredients||"");
}

function normalizedDishTokens(value){
  const ignore=new Set([
    "recipe","recipes","easy","quick","best","homemade","classic","simple",
    "the","and","with","for","style","my","a","an","of","in","on",
    "copycat","favorite","favourite","delicious","yummy"
  ]);
  return photoTokens(value).filter(token=>!ignore.has(token));
}

function dishTitleAgreement(recipeName,candidateName){
  const a=normalizedDishTokens(recipeName);
  const b=new Set(normalizedDishTokens(candidateName));
  if(!a.length) return 0;
  const hits=a.filter(t=>b.has(t)).length;
  return hits/a.length;
}

function datasetIngredientAgreement(recipe,row){
  const wanted=[...new Set((recipe?.ingredients||[]).map(ingredientKey).filter(Boolean))];
  const candidate=parseFoodComIngredientsFromDatasetRow(row).map(ingredientKey).filter(Boolean);
  if(!wanted.length || !candidate.length) return {hits:0,coverage:0};
  const hits=wanted.filter(w=>candidate.some(c=>ingredientKeysMatch(w,c))).length;
  return {hits,coverage:hits/wanted.length};
}

function foodComDatasetPhotoRecord(recipe,row,matchType="exact-foodcom"){
  const images=parseRecipeImageUrls(row?.Images);
  if(!images.length) return null;
  return {
    recipeId:recipe.id,
    thumbnail:images[0],
    alternates:images.slice(1),
    original:images[0],
    landingPage:recipe.recipeSource||`https://www.food.com/recipe/${recipe.recipeSourceId||""}`,
    creator:String(row?.AuthorName||"Food.com recipe contributor"),
    creatorUrl:"",
    license:"Food.com dataset image",
    licenseUrl:"",
    provider:"Food.com",
    source:"Food.com recipe dataset",
    attribution:matchType==="exact-foodcom"
      ?"Photo belongs to this exact Food.com recipe record."
      :"Photo belongs to a strongly matching Food.com recipe record.",
    query:recipe.name,
    matchQuality:matchType,
    resolvedAt:new Date().toISOString()
  };
}

async function hfFoodComRequest(path,params,timeoutMs=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const url=new URL(`${FOODCOM_HF_API}/${path}`);
    Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value)));
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:"application/json"}});
    if(!response.ok) return null;
    return await response.json();
  }catch{
    return null;
  }finally{
    clearTimeout(timer);
  }
}

async function lookupExactFoodComDatasetRow(recipe){
  const sourceId=Number(recipe?.recipeSourceId);
  if(!Number.isFinite(sourceId)) return null;
  if(exactFoodComNoImage.has(String(sourceId))) return null;
  if(exactFoodComLookupPending.has(sourceId)) return exactFoodComLookupPending.get(sourceId);

  const task=(async()=>{
    const data=await hfFoodComRequest("filter",{
      dataset:FOODCOM_HF_DATASET,
      config:FOODCOM_HF_CONFIG,
      split:FOODCOM_HF_SPLIT,
      where:`"RecipeId"=${sourceId}`,
      offset:0,
      length:2
    });
    const row=data?.rows?.[0]?.row||null;
    if(!row) return null;

    const exactName=clean(row.Name||"")===clean(recipe.name||"");
    if(!exactName && dishTitleAgreement(recipe.name,row.Name)<0.9) return null;

    const record=foodComDatasetPhotoRecord(recipe,row,"exact-foodcom");
    if(!record && row) exactFoodComNoImage.add(String(sourceId));
    return record;
  })();

  exactFoodComLookupPending.set(sourceId,task);
  try{return await task;}
  finally{exactFoodComLookupPending.delete(sourceId);}
}

async function prefetchExactFoodComPhotos(recipeIds){
  const recipes=[...new Set(recipeIds||[])]
    .map(findRecipe)
    .filter(Boolean)
    .filter(r=>Number.isFinite(Number(r.recipeSourceId)))
    .slice(0,18);

  let cursor=0;
  async function worker(){
    while(cursor<recipes.length){
      const recipe=recipes[cursor++];
      try{
        if(recipePhotoMemory.has(recipe.id)) continue;
        if(await getCachedRecipePhoto(recipe.id)) continue;
        const record=await lookupExactFoodComDatasetRow(recipe);
        if(!record?.thumbnail) continue;
        if(!(await verifyRecipePhotoUrl(record.thumbnail))) continue;
        await cacheRecipePhoto(record);
        document.querySelectorAll(`img[data-recipe-photo-id="${CSS.escape(recipe.id)}"]`).forEach(img=>{
          img.dataset.resolvedPhoto="1";
          img.src=record.thumbnail;
        });
      }catch{}
    }
  }
  await Promise.all([worker(),worker(),worker()]);
}

async function searchSameDishFoodComPhoto(recipe){
  const data=await hfFoodComRequest("search",{
    dataset:FOODCOM_HF_DATASET,
    config:FOODCOM_HF_CONFIG,
    split:FOODCOM_HF_SPLIT,
    query:recipe.name,
    offset:0,
    length:40
  },12000);
  if(!data?.rows?.length) return null;

  const profile=recipePhotoSemanticProfile(recipe);
  const candidates=[];

  for(const entry of data.rows){
    const row=entry?.row||{};
    const images=parseRecipeImageUrls(row.Images);
    if(!images.length) continue;

    const titleScore=dishTitleAgreement(recipe.name,row.Name||"");
    if(titleScore<0.72) continue;

    const ingredientScore=datasetIngredientAgreement(recipe,row);
    const candidateGroups=detectPhotoGroups(`${row.Name||""} ${parseFoodComIngredientsFromDatasetRow(row).join(" ")}`);
    if(conflictingPhotoGroup(profile.primaryGroup,candidateGroups)) continue;

    // Require both a strong dish-title relationship and recipe ingredient
    // evidence. Exact/super-close titles can pass with slightly less overlap.
    const ingredientOK=
      ingredientScore.coverage>=0.35 ||
      ingredientScore.hits>=3 ||
      (titleScore>=0.95 && ingredientScore.hits>=1);
    if(!ingredientOK) continue;

    candidates.push({
      row,titleScore,
      ingredientCoverage:ingredientScore.coverage,
      ingredientHits:ingredientScore.hits,
      score:(titleScore*100)+(ingredientScore.coverage*45)+(ingredientScore.hits*3)
    });
  }

  candidates.sort((a,b)=>b.score-a.score);
  for(const candidate of candidates.slice(0,8)){
    const record=foodComDatasetPhotoRecord(recipe,candidate.row,"same-dish-foodcom");
    if(!record) continue;
    if(await verifyRecipePhotoUrl(record.thumbnail)) return record;
    for(const alt of record.alternates||[]){
      if(await verifyRecipePhotoUrl(alt)){
        record.thumbnail=alt;
        record.original=alt;
        record.alternates=(record.alternates||[]).filter(x=>x!==alt);
        return record;
      }
    }
  }
  return null;
}

async function resolveCurrentFoodComPagePhoto(recipe){
  const page=String(recipe?.recipeSource||"").trim();
  if(!/^https:\/\/www\.food\.com\/recipe\//i.test(page)) return null;
  try{
    // Jina Reader returns the current public recipe page as text. This can
    // catch photos added to Food.com after the static dataset snapshot.
    const response=await fetch(`https://r.jina.ai/${page}`,{
      headers:{Accept:"text/plain"},
      signal:AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
    });
    if(!response.ok) return null;
    const text=await response.text();
    const titleLine=(text.match(/^Title:\s*(.+)$/mi)||[])[1]||"";
    if(titleLine && dishTitleAgreement(recipe.name,titleLine)<0.72) return null;

    const urls=[...new Set(
      [...text.matchAll(/https:\/\/img\.sndimg\.com\/[^\s)"'>]+/gi)]
        .map(m=>m[0].replace(/&amp;/g,"&"))
    )];
    for(const photoUrl of urls.slice(0,10)){
      if(await verifyRecipePhotoUrl(photoUrl)){
        return {
          recipeId:recipe.id,thumbnail:photoUrl,alternates:urls.filter(x=>x!==photoUrl),
          original:photoUrl,landingPage:page,
          creator:"Food.com recipe contributor",creatorUrl:page,
          license:"Food.com recipe-page image",licenseUrl:page,
          provider:"Food.com",source:page,
          attribution:"Photo found on the current page for this exact recipe.",
          query:recipe.name,matchQuality:"current-exact-foodcom-page",
          resolvedAt:new Date().toISOString()
        };
      }
    }
  }catch{}
  return null;
}

async function resolveLicensedRecipePhoto(recipeId){
  const recipe=findRecipe(recipeId);
  if(!recipe) return null;

  const cached=await getCachedRecipePhoto(recipeId);
  if(cached?.thumbnail && !rejectedRecipePhotoUrls.has(cached.thumbnail)) return cached;

  const explicit=String(recipe.photo||"").trim();
  if(explicit && !/loremflickr\.com|picsum\.photos/i.test(explicit)){
    if(await verifyRecipePhotoUrl(explicit)){
      const own={
        recipeId,thumbnail:explicit,alternates:[],original:explicit,
        landingPage:recipe.recipeSource||"",
        creator:"Recipe source",creatorUrl:recipe.recipeSource||"",
        license:"Source-provided image",licenseUrl:recipe.recipeSource||"",
        provider:recipe.sourceProvider||"PantryPal",source:recipe.recipeSource||"",
        query:recipe.name,matchQuality:"provided",
        resolvedAt:new Date().toISOString()
      };
      await cacheRecipePhoto(own);
      return own;
    }
  }

  // 1. Exact current Food.com recipe page. This is the strongest relationship
  // possible: the photograph displayed on this exact recipe's source page.
  const exactCurrent=await resolveCurrentFoodComPagePhoto(recipe);
  if(exactCurrent){
    await cacheRecipePhoto(exactCurrent);
    return exactCurrent;
  }

  // 2. Exact Food.com dataset row by RecipeId.
  const exactDataset=await lookupExactFoodComDatasetRow(recipe);
  if(exactDataset){
    if(await verifyRecipePhotoUrl(exactDataset.thumbnail)){
      await cacheRecipePhoto(exactDataset);
      return exactDataset;
    }
    for(const alt of exactDataset.alternates||[]){
      if(await verifyRecipePhotoUrl(alt)){
        exactDataset.thumbnail=alt;
        exactDataset.original=alt;
        exactDataset.alternates=(exactDataset.alternates||[]).filter(x=>x!==alt);
        await cacheRecipePhoto(exactDataset);
        return exactDataset;
      }
    }
  }

  // 3. Another Food.com record only when the dish title and ingredients both
  // strongly agree.
  const sameDish=await searchSameDishFoodComPhoto(recipe);
  if(sameDish){
    await cacheRecipePhoto(sameDish);
    return sameDish;
  }

  // 4. TheMealDB exact/close verified recipe match.
  const mealDb=await searchTheMealDBRecipePhoto(recipe);
  if(mealDb){
    await cacheRecipePhoto(mealDb);
    return mealDb;
  }

  // 5. Strict Wikimedia Commons and Openverse matching.
  const queries=recipePhotoQueries(recipe);
  for(const query of queries){
    const commons=await searchCommonsRecipePhoto(query,recipe);
    if(commons){
      await cacheRecipePhoto(commons);
      return commons;
    }
  }
  for(const query of queries){
    const openverse=await searchOpenverseRecipePhoto(query,recipe);
    if(openverse){
      await cacheRecipePhoto(openverse);
      return openverse;
    }
  }

  // 6. Last resort still goes through the stricter semantic checks already
  // built into broadPhotoCandidateAccepted(), including conflict rejection.
  const broad=await findBroadRecipePhoto(recipe);
  if(broad){
    await cacheRecipePhoto(broad);
    return broad;
  }

  return null;
}

async function searchMealDbByIngredientsForPhoto(recipe){
  const ingredientQueries=(recipe.ingredients||[])
    .map(stripQuantity)
    .map(ingredientKey)
    .filter(Boolean)
    .slice(0,4);

  const mealIds=new Map();

  for(const ingredient of ingredientQueries){
    try{
      const response=await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`);
      if(!response.ok) continue;
      const data=await response.json();
      for(const meal of (Array.isArray(data.meals)?data.meals:[]).slice(0,18)){
        if(!meal?.idMeal || !meal?.strMealThumb) continue;
        const current=mealIds.get(meal.idMeal)||{meal,hits:0};
        current.hits++;
        mealIds.set(meal.idMeal,current);
      }
    }catch{}
  }

  const candidates=[...mealIds.values()]
    .sort((a,b)=>b.hits-a.hits)
    .slice(0,16);

  for(const item of candidates){
    try{
      const response=await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(item.meal.idMeal)}`);
      if(!response.ok) continue;
      const data=await response.json();
      const meal=Array.isArray(data.meals)?data.meals[0]:null;
      if(!meal?.strMealThumb) continue;

      // Reject a clearly conflicting main protein/food even in the broad pass.
      const primary=recipePhotoSemanticProfile(recipe).primaryGroup;
      const groups=detectPhotoGroups(`${meal.strMeal||""} ${mealDbIngredients(meal).map(x=>x.name).join(" ")}`);
      if(conflictingPhotoGroup(primary,groups)) continue;

      const recipeIng=(recipe.ingredients||[]).map(ingredientKey).filter(Boolean);
      const mealIng=mealDbIngredients(meal).map(x=>ingredientKey(x.name)).filter(Boolean);
      const overlap=recipeIng.filter(r=>mealIng.some(m=>ingredientKeysMatch(r,m))).length;
      const coverage=recipeIng.length ? overlap/recipeIng.length : 0;

      // Require at least a useful ingredient relationship.
      if(overlap<3 && coverage<.35 && item.hits<3) continue;

      const large=`${meal.strMealThumb}/large`;
      const photoUrl=(await verifyRecipePhotoUrl(large)) ? large :
        ((await verifyRecipePhotoUrl(meal.strMealThumb)) ? meal.strMealThumb : "");
      if(!photoUrl) continue;

      return {
        recipeId:recipe.id,
        thumbnail:photoUrl,
        original:meal.strMealThumb,
        landingPage:meal.strSource||`https://www.themealdb.com/meal/${meal.idMeal}`,
        creator:"TheMealDB contributor",
        creatorUrl:"https://www.themealdb.com/",
        license:"TheMealDB image/source terms",
        licenseUrl:"https://www.themealdb.com/terms.php",
        provider:"TheMealDB",
        source:meal.strSource||`https://www.themealdb.com/meal/${meal.idMeal}`,
        attribution:"Matched by shared recipe ingredients",
        query:ingredientQueries.join(", "),
        matchQuality:`ingredient-overlap-${overlap}`,
        mealDbId:meal.idMeal,
        resolvedAt:new Date().toISOString()
      };
    }catch{}
  }
  return null;
}

function broadPhotoCandidateAccepted(candidate,recipe){
  const hay=photoCandidateText(candidate);
  if(!hay) return false;

  const profile=recipePhotoSemanticProfile(recipe);
  const candidateGroups=detectPhotoGroups(hay);
  if(conflictingPhotoGroup(profile.primaryGroup,candidateGroups)) return false;

  const titleTokens=new Set(photoTokens(hay));
  const nameHits=profile.nameTokens.filter(t=>titleTokens.has(t)||hay.includes(t)).length;
  const ingredientHits=profile.ingredientTokens.filter(t=>titleTokens.has(t)||hay.includes(t)).length;
  const groupMatch=!profile.primaryGroup || candidateGroups.includes(profile.primaryGroup);

  // Reject generic or weakly related food photos.
  return (
    nameHits>=2 ||
    (groupMatch && nameHits>=1 && ingredientHits>=1) ||
    (groupMatch && ingredientHits>=3)
  );
}

async function searchCommonsBroadPhoto(recipe){
  const queries=[
    `${recipe.name} dish`,
    `${recipe.name} food`,
    `${(recipe.ingredients||[]).slice(0,3).map(stripQuantity).join(" ")} meal`,
    `${recipe.category||""} ${(recipe.ingredients||[])[0]||""} food`
  ].filter(Boolean);

  for(const query of queries){
    try{
      const params=new URLSearchParams({
        action:"query",format:"json",origin:"*",generator:"search",
        gsrsearch:query,gsrnamespace:"6",gsrlimit:"30",
        prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"720"
      });
      const response=await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
      if(!response.ok) continue;
      const data=await response.json();
      const pages=Object.values(data?.query?.pages||{});

      for(const page of pages){
        const info=page.imageinfo?.[0];
        if(!info?.thumburl&&!info?.url) continue;
        const meta=info.extmetadata||{};
        const candidate={
          title:`${page.title||""} ${stripTags(meta.ImageDescription?.value||"")} ${stripTags(meta.ObjectName?.value||"")}`,
          tags:[]
        };
        if(!broadPhotoCandidateAccepted(candidate,recipe)) continue;

        const photoUrl=info.thumburl||info.url;
        if(!(await verifyRecipePhotoUrl(photoUrl))) continue;

        return {
          recipeId:recipe.id,
          thumbnail:photoUrl,
          original:info.url||photoUrl,
          landingPage:info.descriptionurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,"_"))}`,
          creator:stripTags(meta.Artist?.value||meta.Credit?.value||"Wikimedia Commons contributor"),
          creatorUrl:"",
          license:stripTags(meta.LicenseShortName?.value||meta.UsageTerms?.value||"Wikimedia Commons license"),
          licenseUrl:meta.LicenseUrl?.value||"",
          provider:"Wikimedia Commons",
          source:"Wikimedia Commons",
          attribution:"",
          query,
          matchQuality:"broad-food-match",
          resolvedAt:new Date().toISOString()
        };
      }
    }catch{}
  }
  return null;
}

async function searchOpenverseBroadPhoto(recipe){
  const queries=[
    `${recipe.name} food`,
    `${recipe.name} dish`,
    `${(recipe.ingredients||[]).slice(0,3).map(stripQuantity).join(" ")} food`
  ].filter(Boolean);

  for(const query of queries){
    try{
      const url=`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=40&categories=photograph&license=cc0,pdm,by,by-sa`;
      const response=await fetch(url,{headers:{Accept:"application/json"}});
      if(!response.ok) continue;
      const data=await response.json();

      for(const candidate of (data.results||[])){
        if(candidate?.mature || !(candidate.thumbnail||candidate.url)) continue;
        if(!broadPhotoCandidateAccepted(candidate,recipe)) continue;

        const photoUrl=candidate.thumbnail||candidate.url;
        if(!(await verifyRecipePhotoUrl(photoUrl))) continue;

        return {
          recipeId:recipe.id,
          thumbnail:photoUrl,
          original:candidate.url||photoUrl,
          landingPage:candidate.foreign_landing_url||candidate.detail_url||"",
          creator:candidate.creator||"Unknown creator",
          creatorUrl:candidate.creator_url||"",
          license:formatOpenLicense(candidate.license,candidate.license_version),
          licenseUrl:candidate.license_url||"",
          provider:candidate.provider||"Openverse",
          source:candidate.source||"Openverse",
          attribution:candidate.attribution||"",
          query,
          matchQuality:"broad-food-match",
          resolvedAt:new Date().toISOString()
        };
      }
    }catch{}
  }
  return null;
}

async function findBroadRecipePhoto(recipe){
  // First try recipes from TheMealDB that share several actual ingredients.
  const mealDb=await searchMealDbByIngredientsForPhoto(recipe);
  if(mealDb) return mealDb;

  // Then broaden the open-license image searches while still rejecting
  // conflicting proteins/food types.
  const commons=await searchCommonsBroadPhoto(recipe);
  if(commons) return commons;

  const openverse=await searchOpenverseBroadPhoto(recipe);
  if(openverse) return openverse;

  return null;
}

function recipePhotoQueries(recipe){
  const ingredients=(recipe.ingredients||[]).map(stripQuantity).map(clean).filter(Boolean);
  const exact=String(recipe.name||"").trim();
  const important=ingredients.slice(0,4).join(" ");
  const profile=recipePhotoSemanticProfile(recipe);
  const primary=profile.primaryGroup ? `${profile.primaryGroup} ` : "";
  return [...new Set([
    exact,
    `"${exact}"`,
    `${exact} plated dish`,
    important ? `${exact} ${important}` : "",
    important ? `${primary}${important} prepared food` : ""
  ].filter(Boolean))];
}
async function searchOpenverseRecipePhoto(query,recipe){
  try{
    const url=`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=30&categories=photograph&license=cc0,pdm,by,by-sa`;
    const response=await fetch(url,{headers:{Accept:"application/json"}});
    if(!response.ok) return null;
    const data=await response.json();
    const rows=(data.results||[])
      .filter(x=>!x.mature && (x.thumbnail||x.url))
      .filter(x=>!rejectedRecipePhotoUrls.has(x.thumbnail||x.url));

    for(const {row:best,quality} of rankPhotoCandidates(rows,recipe).slice(0,10)){
      const photoUrl=best.thumbnail||best.url;
      if(!(await verifyRecipePhotoUrl(photoUrl))) continue;
      return {
        recipeId:recipe.id,
        thumbnail:photoUrl,
        original:best.url||photoUrl,
        landingPage:best.foreign_landing_url||best.detail_url||"",
        creator:best.creator||"Unknown creator",
        creatorUrl:best.creator_url||"",
        license:formatOpenLicense(best.license,best.license_version),
        licenseUrl:best.license_url||"",
        provider:best.provider||"Openverse",
        source:best.source||"Openverse",
        attribution:best.attribution||"",
        query,
        matchQuality:`verified-${quality.score}`,
        resolvedAt:new Date().toISOString()
      };
    }
    return null;
  }catch{return null;}
}
function choosePhotoCandidate(rows,recipe){
  return rankPhotoCandidates(rows,recipe)[0]?.row || null;
}
function formatOpenLicense(code,version){ const c=String(code||"Open license").toUpperCase(); return version?`${c} ${version}`:c; }
async function searchCommonsRecipePhoto(query,recipe){
  try{
    const params=new URLSearchParams({
      action:"query",format:"json",origin:"*",generator:"search",
      gsrsearch:`${query} food`,gsrnamespace:"6",gsrlimit:"20",
      prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"720"
    });
    const response=await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if(!response.ok) return null;
    const data=await response.json();
    const pages=Object.values(data?.query?.pages||{});
    const rows=pages.map(page=>{
      const info=page.imageinfo?.[0]; if(!info?.thumburl&&!info?.url) return null;
      const meta=info.extmetadata||{};
      return {
        page,info,meta,
        title:`${page.title||""} ${stripTags(meta.ImageDescription?.value||"")} ${stripTags(meta.ObjectName?.value||"")}`,
        tags:[]
      };
    }).filter(Boolean);

    for(const {row:best,quality} of rankPhotoCandidates(rows,recipe).slice(0,10)){
      const photoUrl=best.info.thumburl||best.info.url;
      if(!photoUrl || rejectedRecipePhotoUrls.has(photoUrl)) continue;
      if(!(await verifyRecipePhotoUrl(photoUrl))) continue;

      const meta=best.meta;
      const creator=stripTags(meta.Artist?.value||meta.Credit?.value||"Wikimedia Commons contributor");
      return {
        recipeId:recipe.id,
        thumbnail:photoUrl,
        original:best.info.url||photoUrl,
        landingPage:best.info.descriptionurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(best.page.title.replace(/ /g,"_"))}`,
        creator,creatorUrl:"",
        license:stripTags(meta.LicenseShortName?.value||meta.UsageTerms?.value||"Wikimedia Commons license"),
        licenseUrl:meta.LicenseUrl?.value||"",
        provider:"Wikimedia Commons",source:"Wikimedia Commons",
        attribution:"",query,
        matchQuality:`verified-${quality.score}`,
        resolvedAt:new Date().toISOString()
      };
    }
    return null;
  }catch{return null;}
}
function stripTags(value){ const el=document.createElement("div"); el.innerHTML=String(value||""); return el.textContent||el.innerText||""; }
function applyRecipePhotoToAll(recipeId,photo){
  if(!photo?.thumbnail) return;
  document.querySelectorAll(`img[data-recipe-photo-id="${CSS.escape(recipeId)}"]`).forEach(img=>{ img.dataset.resolvedPhoto="1"; img.dataset.photoRetry="0"; if(img.src!==photo.thumbnail) img.src=photo.thumbnail; });
  if(activeRecipeId===recipeId) updateDialogPhotoCredit(recipeId,photo);
}
async function updateDialogPhotoCredit(recipeId,provided){
  const wrap=$(".dialog-image-wrap"); if(!wrap) return;
  let credit=$("#dialogPhotoCredit"); if(!credit){ credit=document.createElement("p"); credit.id="dialogPhotoCredit"; credit.className="photo-credit"; wrap.insertAdjacentElement("afterend",credit); }
  const photo=provided||await getCachedRecipePhoto(recipeId);
  if(!photo){ credit.textContent="Finding an openly licensed photo…"; return; }
  const creator=escapeHTML(photo.creator||"Unknown creator"), provider=escapeHTML(photo.provider||photo.source||"Photo source"), license=escapeHTML(photo.license||"Open license");
  const creatorHtml=photo.creatorUrl?`<a href="${escapeHTML(photo.creatorUrl)}" target="_blank" rel="noopener noreferrer">${creator}</a>`:creator;
  const sourceHtml=photo.landingPage?`<a href="${escapeHTML(photo.landingPage)}" target="_blank" rel="noopener noreferrer">${provider}</a>`:provider;
  const licenseHtml=photo.licenseUrl?`<a href="${escapeHTML(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${license}</a>`:license;
  credit.innerHTML=`Photo: ${creatorHtml} • ${sourceHtml} • ${licenseHtml}`;
}
async function renderPhotoCreditsPage(){
  const list=$("#photoCreditsList"); if(!list) return;
  const rows=(await allCachedRecipePhotos()).sort((a,b)=>{ const an=findRecipe(a.recipeId)?.name||a.recipeId,bn=findRecipe(b.recipeId)?.name||b.recipeId; return an.localeCompare(bn); });
  if(!rows.length){ list.innerHTML='<p class="empty-message">Photo credits will appear here as PantryPal loads recipe photographs. Every resolved photo keeps its creator, source, and license information.</p>'; return; }
  list.innerHTML=rows.map(photo=>{ const recipe=findRecipe(photo.recipeId); return `<article class="credit-card"><img src="${escapeHTML(photo.thumbnail)}" alt="${escapeHTML(recipe?.name||"Recipe")}" loading="lazy"><div><h2>${escapeHTML(recipe?.name||photo.recipeId)}</h2><p><strong>Photo:</strong> ${escapeHTML(photo.creator||"Unknown creator")}</p><p><strong>Source:</strong> ${photo.landingPage?`<a href="${escapeHTML(photo.landingPage)}" target="_blank" rel="noopener noreferrer">${escapeHTML(photo.provider||photo.source||"View source")}</a>`:escapeHTML(photo.provider||photo.source||"Open source")}</p><p><strong>License:</strong> ${photo.licenseUrl?`<a href="${escapeHTML(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(photo.license||"Open license")}</a>`:escapeHTML(photo.license||"Open license")}</p></div></article>`; }).join("");
}





function pantryPalBackup(){
  const data={version:1,app:"PantryPal",exportedAt:new Date().toISOString(),stores:{}};
  Object.entries(STORE).forEach(([name,key])=>{
    data.stores[name]=load(key,null);
  });
  return data;
}

function bindDataTools(){
  $("#exportAllDataButton")?.addEventListener("click",()=>{
    downloadJSON("pantrypal-complete-backup.json",pantryPalBackup());
    announce("PantryPal backup exported");
  });

  $("#importAllDataInput")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    try{
      const parsed=JSON.parse(await file.text());
      if(parsed?.app!=="PantryPal" || !parsed?.stores || typeof parsed.stores!=="object"){
        throw new Error("Not a PantryPal backup");
      }
      if(!confirm("Restore this PantryPal backup? This will replace the app data currently saved in this browser.")) return;
      Object.entries(STORE).forEach(([name,key])=>{
        if(Object.prototype.hasOwnProperty.call(parsed.stores,name)){
          save(key,parsed.stores[name]);
        }
      });
      announce("PantryPal backup restored");
      alert("Backup restored. PantryPal will reload now.");
      location.href="index.html";
    }catch{
      alert("That file could not be restored as a PantryPal backup.");
    }finally{
      e.target.value="";
    }
  });
}

(function markActiveNav(){
  const page=document.body?.dataset?.page;
  if(!page) return;
  document.querySelectorAll(".app-nav [data-page]").forEach(a=>{
    if(a.dataset.page===page) a.setAttribute("aria-current","page");
  });
})();



/* ========================================================================
   RESTORED + HARDENED CORE FUNCTIONALITY
   ======================================================================== */

function buildCategoryFilter(){
  const filter=$("#categoryFilter");
  if(!filter || filter.dataset.ready) return;
  [...new Set(allRecipes().map(r=>r.category||"Other"))].sort().forEach(c=>{
    const o=document.createElement("option");
    o.value=c; o.textContent=c; filter.appendChild(o);
  });
  filter.dataset.ready="1";
}

function rememberRecentRecipe(id){
  const recent=load(STORE.recentRecipes,[]).filter(x=>x!==id);
  recent.unshift(id);
  save(STORE.recentRecipes,recent.slice(0,8));
  if($("#homeRecentRecipes")) renderHomeRecent();
}

function updateOnlineLinks(){
  if(!$("#googleSearchLink")) return;
  const names=ingredientNames();
  const base=names.length?names.join(" "):"easy weeknight dinner";
  const q=encodeURIComponent(`${base} recipe`);
  $("#googleSearchLink").href=`https://www.google.com/search?q=${q}`;
  $("#allrecipesSearchLink").href=`https://www.allrecipes.com/search?q=${q}`;
  $("#budgetBytesSearchLink").href=`https://www.google.com/search?q=site%3Abudgetbytes.com+${q}`;
}

/* ---------------- Planner ---------------- */
let plannerPickerSlot = "";

function plannerRecipeOptions(query=""){
  const q=clean(query);
  let rows=allRecipes().map(recipeMatch);
  if(q){
    rows=rows.filter(({recipe})=>clean(`${recipe.name} ${recipe.category||""} ${recipe.summary||""} ${(recipe.ingredients||[]).join(" ")}`).includes(q));
  }
  rows.sort((a,b)=>inventory.length?compareRecipeMatches(a,b):a.recipe.name.localeCompare(b.recipe.name));
  return rows.slice(0,36);
}

function ensurePlannerPicker(){
  let dialog=$("#plannerPickerDialog");
  if(dialog) return dialog;
  dialog=document.createElement("dialog");
  dialog.id="plannerPickerDialog";
  dialog.className="planner-picker-dialog";
  dialog.innerHTML=`
    <section class="planner-picker-card">
      <div class="planner-picker-head">
        <div>
          <p class="eyebrow">Choose a recipe</p>
          <h2 id="plannerPickerTitle">Add a meal</h2>
        </div>
        <button id="closePlannerPicker" class="dialog-close" type="button" aria-label="Close recipe picker">×</button>
      </div>
      <label class="planner-picker-search">
        <span class="sr-only">Search recipes</span>
        <input id="plannerPickerSearch" type="search" placeholder="Search recipes or ingredients..." autocomplete="off">
      </label>
      <div id="plannerPickerResults" class="planner-picker-results"></div>
    </section>`;
  document.body.appendChild(dialog);
  $("#closePlannerPicker")?.addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",e=>{ if(e.target===dialog) dialog.close(); });
  $("#plannerPickerSearch")?.addEventListener("input",()=>renderPlannerPickerResults());
  return dialog;
}

function openPlannerPicker(slot, label="meal"){
  plannerPickerSlot=slot;
  const dialog=ensurePlannerPicker();
  if($("#plannerPickerTitle")) $("#plannerPickerTitle").textContent=`Choose ${label}`;
  if($("#plannerPickerSearch")) $("#plannerPickerSearch").value="";
  renderPlannerPickerResults();
  dialog.showModal();
  setTimeout(()=>$("#plannerPickerSearch")?.focus(),0);
}

function renderPlannerPickerResults(){
  const wrap=$("#plannerPickerResults");
  if(!wrap) return;
  const rows=plannerRecipeOptions($("#plannerPickerSearch")?.value||"");
  wrap.innerHTML=rows.length ? rows.map(({recipe,score,missing})=>`
    <article class="planner-picker-recipe">
      <div class="planner-picker-photo">${recipeImageTag(recipe,'loading="lazy"')}</div>
      <div class="planner-picker-copy">
        <h3>${escapeHTML(recipe.name)}</h3>
        <small>${inventory.length?`${score}% match • ${missing.length} missing`:escapeHTML(recipe.category||"Recipe")}</small>
      </div>
      <button type="button" data-select-planner-recipe="${escapeHTML(recipe.id)}">Choose</button>
    </article>`).join("") : '<p class="empty-message">No recipes match that search.</p>';
  wrap.querySelectorAll("[data-select-planner-recipe]").forEach(b=>b.addEventListener("click",()=>{
    if(!plannerPickerSlot) return;
    plan[plannerPickerSlot]=b.dataset.selectPlannerRecipe;
    save(STORE.plan,plan);
    ensurePlannerPicker().close();
    renderPlanner();
    renderGroceryList();
    if($("#homeRecommendations")) renderHomeDashboard();
    announce("Meal added to planner");
  }));
  hydrateRecipeImages(wrap);
}

function plannerSlotMarkup(date,meal,compact=false){
  const key=slotKey(date,meal.key);
  const r=findRecipe(plan[key]);
  if(compact){
    return `<div class="mobile-meal-row ${r?"has-recipe":""}">
      <div class="mobile-meal-icon">${r?`<div class="planner-recipe-thumb">${recipeImageTag(r,'loading="lazy"')}</div>`:`<span aria-hidden="true">${meal.icon}</span>`}</div>
      <div class="mobile-meal-copy">
        <strong>${escapeHTML(meal.key)}</strong>
        <small>${r?escapeHTML(r.name):"Nothing planned"}</small>
      </div>
      <div class="mobile-meal-actions">
        <button class="soft-button" type="button" data-pick-slot="${escapeHTML(key)}" data-meal-label="${escapeHTML(meal.key.toLowerCase())}">${r?"Change":"Choose"}</button>
        ${r?`<button class="text-button" type="button" data-open="${escapeHTML(r.id)}">View</button><button class="text-button danger" type="button" data-clear-slot="${escapeHTML(key)}">Clear</button>`:""}
      </div>
    </div>`;
  }
  return `<div class="grid-cell">
    <div class="slot-card ${r?"has-recipe":""}">
      ${r?`<div class="planner-recipe-thumb">${recipeImageTag(r,'loading="lazy"')}</div>`:`<div class="planner-empty-icon" aria-hidden="true">${meal.icon}</div>`}
      <strong>${r?escapeHTML(r.name):"Choose meal"}</strong>
      <div class="planner-slot-actions">
        <button class="soft-button" type="button" data-pick-slot="${escapeHTML(key)}" data-meal-label="${escapeHTML(meal.key.toLowerCase())}">${r?"Change":"Choose"}</button>
        ${r?`<button class="text-button" type="button" data-open="${escapeHTML(r.id)}">View</button><button class="text-button danger" type="button" data-clear-slot="${escapeHTML(key)}">Clear</button>`:""}
      </div>
    </div>
  </div>`;
}

function bindPlannerSlotButtons(container){
  if(!container) return;
  bindRecipeButtons(container);
  container.querySelectorAll("[data-pick-slot]").forEach(b=>b.addEventListener("click",()=>openPlannerPicker(b.dataset.pickSlot,b.dataset.mealLabel||"meal")));
  container.querySelectorAll("[data-clear-slot]").forEach(b=>b.addEventListener("click",()=>{
    delete plan[b.dataset.clearSlot];
    save(STORE.plan,plan);
    renderPlanner();
    renderGroceryList();
    announce("Meal removed from planner");
  }));
}

function renderWeekGrid(){
  const target=$("#mealGrid");
  if(!target) return;
  const start=startOfWeek(plannerDate);
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d;});

  let desktop='<div class="week-desktop-board">';
  desktop+='<div class="grid-cell grid-head grid-corner">Meal</div>';
  desktop+=dates.map(d=>`<div class="grid-cell grid-head">${DAYS[d.getDay()]}<small>${d.getMonth()+1}/${d.getDate()}</small></div>`).join("");
  MEALS.forEach(meal=>{
    desktop+=`<div class="grid-cell meal-name"><span>${meal.icon}</span>${meal.key}</div>`;
    dates.forEach(d=>desktop+=plannerSlotMarkup(d,meal,false));
  });
  desktop+='</div>';

  const mobile=`<div class="week-mobile-list">${dates.map(d=>`
    <article class="mobile-day-card">
      <header><div><strong>${d.toLocaleDateString(undefined,{weekday:"long"})}</strong><span>${d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span></div></header>
      <div class="mobile-day-meals">${MEALS.map(meal=>plannerSlotMarkup(d,meal,true)).join("")}</div>
    </article>`).join("")}</div>`;

  target.innerHTML=desktop+mobile;
  bindPlannerSlotButtons(target);
  hydrateRecipeImages(target);
}

function renderMonthGrid(){
  const target=$("#monthGrid");
  if(!target) return;
  const first=new Date(plannerDate.getFullYear(),plannerDate.getMonth(),1,12);
  const start=new Date(first); start.setDate(1-first.getDay());
  let html="";
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const inMonth=d.getMonth()===plannerDate.getMonth();
    html+=`<article class="month-day ${inMonth?"":"outside-month"}">
      <div class="month-day-head"><strong>${d.getDate()}</strong><small>${d.toLocaleDateString(undefined,{weekday:"short"})}</small></div>
      <div class="month-day-meals">
        ${MEALS.map(meal=>{
          const key=slotKey(d,meal.key), r=findRecipe(plan[key]);
          return `<button type="button" class="month-meal-button ${r?"planned":""}" data-pick-slot="${escapeHTML(key)}" data-meal-label="${escapeHTML(meal.key.toLowerCase())}">
            <span>${meal.icon}</span><strong>${meal.key.slice(0,1)}</strong><small>${r?escapeHTML(r.name):"Add"}</small>
          </button>`;
        }).join("")}
      </div>
    </article>`;
  }
  target.innerHTML=html;
  bindPlannerSlotButtons(target);
}

function bindPlanSelects(container){
  // Kept for compatibility with older saved markup. The current planner uses
  // the searchable recipe picker rather than thousands of <option> elements.
  container?.querySelectorAll("[data-slot]").forEach(s=>s.addEventListener("change",()=>{
    if(s.value) plan[s.dataset.slot]=s.value;
    else delete plan[s.dataset.slot];
    save(STORE.plan,plan);
    renderPlanner();
    renderGroceryList();
  }));
}

function clearCurrentPlanView(){
  if(!confirm(`Clear the current ${plannerView}?`)) return;
  const keys=Object.keys(plan);
  if(plannerView==="week"){
    const start=startOfWeek(plannerDate),end=new Date(start);end.setDate(start.getDate()+6);
    keys.forEach(k=>{const d=dateFromSlotKey(k);if(d&&d>=start&&d<=end) delete plan[k];});
  }else{
    keys.forEach(k=>{const d=dateFromSlotKey(k);if(d&&d.getFullYear()===plannerDate.getFullYear()&&d.getMonth()===plannerDate.getMonth()) delete plan[k];});
  }
  save(STORE.plan,plan);
  renderPlanner();
  renderGroceryList();
}

function addRecipeToNextOpenSlot(recipeId){
  let d=new Date();
  for(let day=0;day<30;day++){
    for(const meal of MEALS){
      const key=slotKey(d,meal.key);
      if(!plan[key]){
        plan[key]=recipeId; save(STORE.plan,plan); return key;
      }
    }
    d.setDate(d.getDate()+1);
  }
  return null;
}

function exportPlan(){
  const rows=Object.entries(plan).map(([key,id])=>{
    const [date,meal]=splitSlotKey(key),r=findRecipe(id);
    return {date,meal,recipe:r?.name||id};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.meal.localeCompare(b.meal));
  downloadJSON("pantrypal-meal-plan.json",rows);
}

/* ---------------- Grocery list ---------------- */
function generatedGroceryItems(){
  const have=inventory.map(i=>ingredientKey(i.name));
  const counts={};
  Object.values(plan).map(findRecipe).filter(Boolean).forEach(r=>{
    (r.ingredients||[]).forEach(raw=>{
      const key=ingredientKey(raw);
      const owned=have.some(h=>ingredientKeysMatch(key,h));
      if(owned) return;
      const label=stripQuantity(raw);
      const normalized=clean(label);
      if(!normalized) return;
      if(!counts[normalized]) counts[normalized]={name:label,count:0};
      counts[normalized].count++;
    });
  });
  return Object.values(counts).map(({name,count})=>({
    id:`auto:${clean(name)}`,name,count,category:groceryCategory(name),manual:false
  }));
}

function renderGroceryList(){
  const wrap=$("#groceryItems");
  if(!wrap) return;
  const auto=generatedGroceryItems();
  const manual=manualGroceries.map(x=>({...x,manual:true,category:x.category||groceryCategory(x.name)}));
  const items=[...auto,...manual].sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  if(!items.length){
    wrap.innerHTML='<p class="empty-message">Plan meals or add a grocery item to build your list.</p>';
    return;
  }
  let current="";
  wrap.innerHTML=items.map(item=>{
    let heading="";
    if(item.category!==current){ current=item.category; heading=`<h3 class="grocery-category">${escapeHTML(current)}</h3>`; }
    return heading+`<label class="grocery-row ${groceryChecked[item.id]?"checked":""}">
      <input type="checkbox" data-grocery-check="${escapeHTML(item.id)}" ${groceryChecked[item.id]?"checked":""}>
      <span>${escapeHTML(titleCase(item.name))}</span>
      <small>${item.count>1?`${item.count} recipes`:""}${item.manual?` <button class="text-button danger inline-delete" data-delete-grocery="${escapeHTML(item.id)}" type="button" aria-label="Delete ${escapeHTML(item.name)}">×</button>`:""}</small>
    </label>`;
  }).join("");
  wrap.querySelectorAll("[data-grocery-check]").forEach(c=>c.addEventListener("change",()=>{
    groceryChecked[c.dataset.groceryCheck]=c.checked;
    save(STORE.groceryChecked,groceryChecked);
    renderGroceryList();
  }));
  wrap.querySelectorAll("[data-delete-grocery]").forEach(b=>b.addEventListener("click",e=>{
    e.preventDefault();
    manualGroceries=manualGroceries.filter(x=>x.id!==b.dataset.deleteGrocery);
    save(STORE.groceries,manualGroceries);
    renderGroceryList();
  }));
}

function addManualGrocery(){
  const input=$("#manualGroceryInput"),name=clean(input?.value);
  if(!name) return;
  manualGroceries.push({id:`manual:${uid()}`,name,category:groceryCategory(name),count:1});
  save(STORE.groceries,manualGroceries);
  input.value="";
  renderGroceryList();
}

function clearCheckedGroceries(){
  const checked=new Set(Object.entries(groceryChecked).filter(([,v])=>v).map(([k])=>k));
  manualGroceries=manualGroceries.filter(x=>!checked.has(x.id));
  Object.keys(groceryChecked).forEach(k=>{if(checked.has(k)) delete groceryChecked[k];});
  save(STORE.groceries,manualGroceries);
  save(STORE.groceryChecked,groceryChecked);
  renderGroceryList();
}

function exportGroceries(){
  const items=[...generatedGroceryItems(),...manualGroceries];
  const text=items.filter(i=>!groceryChecked[i.id]).map(i=>`${i.count>1?i.count+" x ":""}${titleCase(i.name)}`).join("\n");
  downloadText("pantrypal-grocery-list.txt",text);
}

/* ---------------- Custom recipes ---------------- */
function renderCustomRecipes(){
  const wrap=$("#customRecipeList");
  if(!wrap) return;
  wrap.innerHTML=customRecipes.length?customRecipes.map(r=>`
    <article class="match-card custom-recipe-card">
      <div class="food-thumb">${recipeImageTag(r,'loading="lazy"')}</div>
      <div><h3>${escapeHTML(r.name)}</h3><small>${escapeHTML(r.category||"Recipe")} • ${r.servings||2} servings</small></div>
      <div class="row-actions">
        <button class="text-button" data-open="${r.id}" type="button">View</button>
        <button class="text-button" data-edit-custom="${r.id}" type="button">Edit</button>
        <button class="text-button danger" data-delete-custom="${r.id}" type="button">Delete</button>
      </div>
    </article>`).join(""):'<p class="empty-message">No custom recipes yet.</p>';
  bindRecipeButtons(wrap);
  wrap.querySelectorAll("[data-edit-custom]").forEach(b=>b.addEventListener("click",()=>editCustomRecipe(b.dataset.editCustom)));
  wrap.querySelectorAll("[data-delete-custom]").forEach(b=>b.addEventListener("click",()=>{
    if(confirm("Delete this recipe?")){
      customRecipes=customRecipes.filter(r=>r.id!==b.dataset.deleteCustom);
      save(STORE.customRecipes,customRecipes); renderCustomRecipes(); updateStats(); renderRecipeLibrary();
    }
  }));
  hydrateRecipeImages(wrap);
}

function saveCustomRecipeFromForm(e){
  e.preventDefault();
  const id=$("#customRecipeId")?.value||`custom-${uid()}`;
  const existing=customRecipes.find(r=>r.id===id);
  const prep=$("#customRecipePrep")?.value.trim()||"",cook=$("#customRecipeCook")?.value.trim()||"";
  const recipe={
    id,
    name:$("#customRecipeName")?.value.trim()||"Untitled recipe",
    category:$("#customRecipeCategory")?.value||"Other",
    servings:Number($("#customRecipeServings")?.value||2),
    time:[prep,cook].filter(Boolean).join(" + ")||"Flexible",
    prepTime:prep,cookTime:cook,
    ingredients:($("#customRecipeIngredients")?.value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
    instructions:$("#customRecipeInstructions")?.value.trim()||"",
    notes:$("#customRecipeNotes")?.value.trim()||"",
    summary:$("#customRecipeNotes")?.value.trim()||"Your saved PantryPal recipe",
    custom:true
  };
  if(existing) Object.assign(existing,recipe); else customRecipes.push(recipe);
  save(STORE.customRecipes,customRecipes);
  resetCustomRecipeForm(); renderCustomRecipes(); updateStats(); renderRecipeLibrary();
  announce("Recipe saved");
}

function editCustomRecipe(id){
  const r=customRecipes.find(x=>x.id===id); if(!r) return;
  $("#customRecipeId").value=r.id;
  $("#customRecipeName").value=r.name;
  $("#customRecipeCategory").value=r.category||"Other";
  $("#customRecipeServings").value=r.servings||2;
  $("#customRecipePrep").value=r.prepTime||"";
  $("#customRecipeCook").value=r.cookTime||"";
  $("#customRecipeIngredients").value=(r.ingredients||[]).join("\n");
  $("#customRecipeInstructions").value=r.instructions||"";
  $("#customRecipeNotes").value=r.notes||"";
  $("#recipeFormHeading").textContent="Edit recipe";
  $("#cancelRecipeEdit").hidden=false;
  window.scrollTo({top:0,behavior:"smooth"});
}

function resetCustomRecipeForm(){
  $("#customRecipeForm")?.reset();
  if($("#customRecipeId")) $("#customRecipeId").value="";
  if($("#recipeFormHeading")) $("#recipeFormHeading").textContent="Add a recipe";
  if($("#cancelRecipeEdit")) $("#cancelRecipeEdit").hidden=true;
}

async function importCustomRecipes(e){
  const f=e.target.files?.[0]; if(!f) return;
  try{
    const parsed=JSON.parse(await f.text());
    const arr=Array.isArray(parsed)?parsed:parsed.recipes||[];
    arr.forEach(r=>{
      if(r.name&&Array.isArray(r.ingredients)){
        r.id=r.id||`custom-${uid()}`;
        r.custom=true;
        const existing=customRecipes.find(x=>x.id===r.id);
        if(existing) Object.assign(existing,r); else customRecipes.push(r);
      }
    });
    save(STORE.customRecipes,customRecipes); renderCustomRecipes(); updateStats(); renderRecipeLibrary();
    announce("Recipes imported");
  }catch{ alert("That recipe file could not be imported."); }
  e.target.value="";
}

function initIngredientWorkspace(){
  const findTab=$("#findRecipesTab"),manageTab=$("#manageKitchenTab");
  if(!findTab||!manageTab) return;
  const entry=$(".ingredient-entry-panel");
  const setMode=mode=>{
    const finding=mode==="find";
    findTab.classList.toggle("active",finding);
    manageTab.classList.toggle("active",!finding);
    findTab.setAttribute("aria-selected",String(finding));
    manageTab.setAttribute("aria-selected",String(!finding));
    document.querySelectorAll('[data-ingredient-section="find"]').forEach(el=>el.hidden=!finding);
    if(entry){
      entry.hidden=false;
      entry.classList.toggle("finder-mode",finding);
    }
  };
  findTab.onclick=()=>setMode("find");
  manageTab.onclick=()=>setMode("manage");
  setMode("find");
}


/* ========================================================================
   SAFE APPLICATION BOOTSTRAP
   Everything above, including the recipe-photo state and enhanced planner,
   must be initialized before any page rendering/event binding starts.
   ======================================================================== */
function bootstrapPantryPal(){
  init();
  startRecipePhotoHydrator();
  renderPhotoCreditsPage();
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", bootstrapPantryPal, {once:true});
}else{
  bootstrapPantryPal();
}
