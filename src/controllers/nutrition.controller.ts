import { Request, Response } from 'express';

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';
const API_KEY = process.env.USDA_API_KEY ?? 'DEMO_KEY';

// Nutrient IDs from USDA FoodData Central
const NUTRIENT_MAP: Record<string, string> = {
  '1008': 'calories',    // Energy (kcal)
  '1003': 'protein',     // Protein
  '1005': 'carbs',       // Carbohydrate, by difference
  '1004': 'fat',         // Total lipid (fat)
  '1079': 'fiber',       // Fiber, total dietary
  '2000': 'sugar',       // Sugars, total
  '1087': 'calcium',     // Calcium, Ca
  '1089': 'iron',        // Iron, Fe
  '1090': 'magnesium',   // Magnesium, Mg
  '1092': 'potassium',   // Potassium, K
  '1093': 'sodium',      // Sodium, Na
  '1095': 'zinc',        // Zinc, Zn
  '1162': 'vitaminC',    // Vitamin C
  '1114': 'vitaminD',    // Vitamin D (D2 + D3)
  '1109': 'vitaminE',    // Vitamin E (alpha-tocopherol)
  '1185': 'vitaminK',    // Vitamin K
  '1106': 'vitaminA',    // Vitamin A, RAE
  '1165': 'vitaminB1',   // Thiamin (B1)
  '1166': 'vitaminB2',   // Riboflavin (B2)
  '1167': 'vitaminB3',   // Niacin (B3)
  '1175': 'vitaminB6',   // Vitamin B-6
  '1177': 'folate',      // Folate, total
  '1178': 'vitaminB12',  // Vitamin B-12
  '1253': 'cholesterol', // Cholesterol
  '1258': 'saturatedFat',// Fatty acids, total saturated
};

interface NutrientResult {
  fdcId: number;
  name: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  nutrients: Partial<Record<string, number>>;
  score: number;
}

function extractNutrients(foodNutrients: Array<{ nutrientId?: number; nutrientNumber?: string; value?: number; amount?: number }>): Partial<Record<string, number>> {
  const result: Partial<Record<string, number>> = {};
  for (const fn of foodNutrients) {
    const id = String(fn.nutrientId ?? fn.nutrientNumber ?? '');
    const key = NUTRIENT_MAP[id];
    if (key) {
      const val = fn.value ?? fn.amount ?? 0;
      result[key] = Math.round(val * 10) / 10;
    }
  }
  return result;
}

// GET /nutrition/search?q=broccoli&limit=10
export const searchFood = async (req: Request, res: Response): Promise<void> => {
  const query = (req.query.q as string ?? '').trim();
  const limit = Math.min(Number(req.query.limit) || 10, 25);

  if (!query || query.length < 2) {
    res.status(400).json({ message: 'q must be at least 2 characters' });
    return;
  }

  try {
    const url = `${FDC_BASE}/foods/search?query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&pageSize=${limit}&api_key=${API_KEY}`;
    const fdcRes = await fetch(url);

    if (!fdcRes.ok) {
      const errText = await fdcRes.text();
      console.error('USDA API error:', fdcRes.status, errText.slice(0, 200));
      res.status(502).json({ message: 'Nutrition data service unavailable' });
      return;
    }

    const data = await fdcRes.json() as {
      foods: Array<{
        fdcId: number;
        description: string;
        brandOwner?: string;
        servingSize?: number;
        servingSizeUnit?: string;
        foodNutrients: Array<{
          nutrientId: number;
          nutrientNumber: string;
          value: number;
        }>;
        score: number;
      }>;
    };

    const foods: NutrientResult[] = (data.foods ?? []).map(f => ({
      fdcId: f.fdcId,
      name: f.description,
      brandOwner: f.brandOwner,
      servingSize: f.servingSize,
      servingSizeUnit: f.servingSizeUnit,
      nutrients: extractNutrients(f.foodNutrients),
      score: f.score ?? 0,
    }));

    res.json({ foods });
  } catch (err) {
    console.error('searchFood error:', err);
    res.status(500).json({ message: 'Failed to search food data' });
  }
};

// ── Evidence-Based Goal Plans ──────────────────────────────────────────────────
// Sources:
// • ISSN Position Stand 2017 (Jäger et al.) — protein 1.4–2.0 g/kg muscle gain
// • Helms et al. 2014 — protein 2.3–3.1 g/kg lean mass during fat loss
// • ACSM/AND/DC Joint Position Statement 2016
// • Dietary Guidelines for Americans 2020-2025
// • BMR estimated via Mifflin-St Jeor (most validated equation per systematic reviews)

interface DayPlan {
  day: string;
  meals: { meal: string; foods: string[]; kcal: number }[];
}

interface GoalPlan {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  color: string;
  rationale: string;
  sources: string[];
  calories: number;
  macros: { protein: number; carbs: number; fat: number; fiber: number };
  rules: string[];
  weekPlan: DayPlan[];
  disclaimer: string;
}

const MUSCLE_GAIN_PLAN: GoalPlan = {
  id: 'muscle_gain',
  title: 'Muscle Gain',
  subtitle: 'Lean bulk — maximize hypertrophy',
  badge: '💪',
  color: '#3B82F6',
  rationale:
    'A 300–500 kcal surplus above TDEE with 1.6–2.2 g protein/kg/day maximizes muscle protein synthesis (MPS) while minimizing fat gain. This range is supported by the ISSN 2017 Position Stand and meta-analyses by Morton et al. (BJSM 2018). Carbohydrates fuel resistance training and support glycogen replenishment.',
  sources: [
    'ISSN Position Stand: Protein and Exercise (2017) — Jäger et al.',
    'Morton et al. BJSM (2018) — protein dose-response meta-analysis',
    'Stokes et al. Nutrients (2018) — leucine threshold & MPS',
    'ACSM/AND/DC Joint Position Statement (2016)',
  ],
  calories: 2600,
  macros: { protein: 175, carbs: 310, fat: 72, fiber: 35 },
  rules: [
    'Eat 4–5 meals spaced 3–4 hours apart to maximize MPS',
    'Include 40–50 g protein per meal for optimal leucine threshold',
    'Time carbs around workouts (pre + post-training)',
    'Eat a casein-rich snack before bed (cottage cheese / Greek yogurt)',
    'Sleep 7–9 hours — growth hormone peaks during deep sleep',
  ],
  weekPlan: [
    {
      day: 'Monday (Push Day)',
      meals: [
        { meal: 'Breakfast (7 AM)', foods: ['4 eggs scrambled', '2 slices whole grain toast', '1 cup oatmeal with berries', '1 glass skim milk'], kcal: 620 },
        { meal: 'Lunch (12 PM)',    foods: ['200g grilled chicken breast', '200g brown rice', '1 cup broccoli with olive oil', '1 medium apple'], kcal: 680 },
        { meal: 'Pre-Workout (3 PM)', foods: ['1 banana', '30g whey protein + water', '2 rice cakes'], kcal: 350 },
        { meal: 'Post-Workout Dinner (7 PM)', foods: ['200g salmon fillet', '250g sweet potato', '2 cups mixed vegetables', '1 tbsp olive oil'], kcal: 660 },
        { meal: 'Night Snack (9 PM)', foods: ['200g low-fat cottage cheese', '1 tbsp almond butter', '10 almonds'], kcal: 290 },
      ],
    },
    {
      day: 'Tuesday (Pull Day)',
      meals: [
        { meal: 'Breakfast', foods: ['200g Greek yogurt', '1 cup granola (no added sugar)', '1 banana', '2 boiled eggs'], kcal: 610 },
        { meal: 'Lunch',     foods: ['200g lean ground turkey wrap (whole wheat tortilla)', 'Lettuce, tomato, avocado ¼', '1 cup lentil soup'], kcal: 700 },
        { meal: 'Pre-Workout', foods: ['1 cup chocolate milk (low-fat)', '1 slice whole grain bread with peanut butter'], kcal: 340 },
        { meal: 'Dinner',   foods: ['200g tuna steak', '200g quinoa', '1 cup asparagus', 'Side salad with olive oil'], kcal: 650 },
        { meal: 'Night Snack', foods: ['30g casein protein shake', '1 cup warm milk'], kcal: 300 },
      ],
    },
    {
      day: 'Wednesday (Leg Day)',
      meals: [
        { meal: 'Breakfast', foods: ['Protein pancakes (2 eggs + 1 scoop protein + banana)', '1 tbsp maple syrup', '1 cup berries'], kcal: 580 },
        { meal: 'Lunch',     foods: ['150g grilled shrimp', '200g white rice', '1 cup edamame', '1 orange'], kcal: 620 },
        { meal: 'Pre-Workout', foods: ['2 rice cakes with hummus', '30g whey protein shake'], kcal: 380 },
        { meal: 'Dinner',   foods: ['200g lean beef stir-fry', '200g noodles', '2 cups mixed veggies', 'Soy sauce/ginger'], kcal: 700 },
        { meal: 'Night Snack', foods: ['200g cottage cheese', '½ cup pineapple chunks'], kcal: 320 },
      ],
    },
    {
      day: 'Thursday (Rest / Active Recovery)',
      meals: [
        { meal: 'Breakfast', foods: ['3 egg omelet with spinach and feta', '2 slices sourdough toast', '1 cup OJ'], kcal: 560 },
        { meal: 'Lunch',     foods: ['Chicken Caesar salad (150g chicken, romaine, parmesan)', 'Whole wheat pita'], kcal: 640 },
        { meal: 'Snack',     foods: ['Greek yogurt parfait with granola and honey', '1 apple'], kcal: 350 },
        { meal: 'Dinner',   foods: ['200g baked cod', '1 cup couscous', '2 cups roasted vegetables', '1 tbsp olive oil'], kcal: 650 },
        { meal: 'Night Snack', foods: ['1 cup low-fat milk', '30g mixed nuts'], kcal: 400 },
      ],
    },
    {
      day: 'Friday (Push/Pull Combo)',
      meals: [
        { meal: 'Breakfast', foods: ['Overnight oats (1 cup oats, chia seeds, almond milk, berries)', '2 hard-boiled eggs'], kcal: 590 },
        { meal: 'Lunch',     foods: ['200g grilled chicken pita wrap', 'Tzatziki, tomato, cucumber', '1 cup brown rice'], kcal: 680 },
        { meal: 'Pre-Workout', foods: ['Banana + peanut butter toast', 'Black coffee'], kcal: 320 },
        { meal: 'Dinner',   foods: ['200g pork tenderloin', '200g mashed sweet potato', '1 cup green beans', '½ avocado'], kcal: 700 },
        { meal: 'Night Snack', foods: ['Chocolate casein pudding (30g casein + water)', '1 cup berries'], kcal: 310 },
      ],
    },
    {
      day: 'Saturday (Leg Day)',
      meals: [
        { meal: 'Breakfast', foods: ['4-egg vegetable scramble (peppers, onion, spinach)', '2 slices whole grain toast', 'Large glass OJ'], kcal: 600 },
        { meal: 'Lunch',     foods: ['200g beef burger (lean, no bun)', 'Large sweet potato fries (baked)', '1 cup coleslaw'], kcal: 720 },
        { meal: 'Pre-Workout', foods: ['Protein bar (≥20g protein, <300 kcal)', '1 banana'], kcal: 400 },
        { meal: 'Dinner',   foods: ['200g salmon', '1 cup quinoa', '1 cup broccoli', '2 tbsp tahini dressing'], kcal: 660 },
        { meal: 'Night Snack', foods: ['200g cottage cheese', '1 tbsp honey', '10 walnut halves'], kcal: 320 },
      ],
    },
    {
      day: 'Sunday (Full Rest)',
      meals: [
        { meal: 'Breakfast', foods: ['Veggie omelette (3 eggs)', 'Whole grain pancakes (2)', '1 cup mixed fruit'], kcal: 560 },
        { meal: 'Lunch',     foods: ['Grilled chicken rice bowl (150g chicken, rice, black beans, salsa, avocado)'], kcal: 680 },
        { meal: 'Snack',     foods: ['Apple + 2 tbsp almond butter', '1 cup skim milk'], kcal: 360 },
        { meal: 'Dinner',   foods: ['200g turkey breast', '200g roasted potatoes', 'Steamed asparagus', '1 tbsp olive oil'], kcal: 640 },
        { meal: 'Night Snack', foods: ['Greek yogurt (200g)', 'Mixed berries', '1 tbsp granola'], kcal: 300 },
      ],
    },
  ],
  disclaimer:
    'This plan is based on ISSN 2017 evidence-based guidelines. Individual calorie and macro needs vary by weight, height, age, and activity level. Consult a registered dietitian or physician before beginning any nutrition program.',
};

const FAT_LOSS_PLAN: GoalPlan = {
  id: 'fat_loss',
  title: 'Fat Loss',
  subtitle: 'Caloric deficit — preserve lean mass',
  badge: '🔥',
  color: '#EF4444',
  rationale:
    'A 400–600 kcal deficit with high protein (1.8–2.4 g/kg/day) protects lean muscle while mobilizing fat stores. High-fiber, low-glycemic carbohydrates improve satiety and prevent energy crashes. This approach follows the ACSM position stand on weight loss and the evidence review by Helms et al. 2014.',
  sources: [
    'Helms et al. JISSN (2014) — protein for fat loss preserving LBM',
    'ACSM Position Stand: Weight Loss and Prevention of Regain (2021)',
    'Sacks et al. NEJM (2009) — macronutrient composition and weight loss',
    'Dietary Guidelines for Americans 2020–2025 (USDA/HHS)',
  ],
  calories: 1750,
  macros: { protein: 160, carbs: 160, fat: 58, fiber: 40 },
  rules: [
    'Maintain a 400–600 kcal daily deficit — never cut more than 1,000 kcal/day',
    'Prioritize protein at every meal to preserve muscle (leucine-rich sources)',
    'Choose high-volume, low-calorie vegetables to increase satiety',
    'Avoid liquid calories (juice, sodas, sugary coffee) — they do not promote fullness',
    'Perform 150–300 min moderate cardio per week (ACSM recommendation)',
    'Weight loss goal: 0.5–1 kg per week maximum for sustainable fat loss',
  ],
  weekPlan: [
    {
      day: 'Monday',
      meals: [
        { meal: 'Breakfast (7 AM)', foods: ['3-egg white omelet with spinach & mushrooms', '1 slice whole grain toast', '1 cup black coffee/green tea'], kcal: 320 },
        { meal: 'Lunch (12 PM)',    foods: ['Large chicken salad (150g grilled chicken, mixed greens, cucumber, tomato)', '2 tbsp olive oil & lemon dressing', '1 small apple'], kcal: 420 },
        { meal: 'Snack (3 PM)',    foods: ['100g low-fat Greek yogurt', '½ cup berries'], kcal: 130 },
        { meal: 'Dinner (7 PM)',   foods: ['180g baked white fish (cod/tilapia)', '1 cup roasted broccoli', '½ cup brown rice', '1 tsp olive oil'], kcal: 430 },
        { meal: 'Evening (9 PM)', foods: ['20g casein protein shake with water', 'Herbal tea'], kcal: 90 },
      ],
    },
    {
      day: 'Tuesday',
      meals: [
        { meal: 'Breakfast', foods: ['Overnight oats (½ cup oats, chia seeds, 150g Greek yogurt, berries)'], kcal: 380 },
        { meal: 'Lunch',     foods: ['Tuna lettuce wraps (140g canned tuna, romaine, avocado ¼, mustard)'], kcal: 350 },
        { meal: 'Snack',     foods: ['2 rice cakes + 1 tbsp almond butter', '1 medium carrot'], kcal: 190 },
        { meal: 'Dinner',   foods: ['150g turkey breast', '2 cups steamed mixed vegetables', '½ cup quinoa', 'Lemon & herbs'], kcal: 420 },
        { meal: 'Evening', foods: ['1 cup warm skim milk', '5 almonds'], kcal: 130 },
      ],
    },
    {
      day: 'Wednesday',
      meals: [
        { meal: 'Breakfast', foods: ['2 scrambled eggs', '1 cup sautéed spinach & tomato', '½ cup oatmeal'], kcal: 360 },
        { meal: 'Lunch',     foods: ['Lentil soup (1.5 cups)', '2 oz whole wheat pita', 'Side salad'], kcal: 410 },
        { meal: 'Snack',     foods: ['1 medium apple', '10 almonds'], kcal: 160 },
        { meal: 'Dinner',   foods: ['180g grilled salmon', '2 cups asparagus', '½ cup sweet potato', '1 tsp olive oil'], kcal: 460 },
        { meal: 'Evening', foods: ['Protein shake (20g)'], kcal: 90 },
      ],
    },
    {
      day: 'Thursday',
      meals: [
        { meal: 'Breakfast', foods: ['Smoothie: 1 cup almond milk, 1 banana, 30g protein powder, 1 cup spinach, ½ cup frozen berries'], kcal: 350 },
        { meal: 'Lunch',     foods: ['Chicken stir-fry (150g chicken, bok choy, snap peas, soy sauce)', '½ cup brown rice'], kcal: 430 },
        { meal: 'Snack',     foods: ['100g cottage cheese', '½ cup pineapple'], kcal: 130 },
        { meal: 'Dinner',   foods: ['150g lean ground turkey taco bowl (lettuce, salsa, ¼ avocado, beans)', '½ cup black beans'], kcal: 450 },
        { meal: 'Evening', foods: ['Herbal tea', '5 walnuts'], kcal: 70 },
      ],
    },
    {
      day: 'Friday',
      meals: [
        { meal: 'Breakfast', foods: ['2 poached eggs on 1 slice whole grain toast', '1 sliced tomato', '1 cup green tea'], kcal: 300 },
        { meal: 'Lunch',     foods: ['Mixed bean salad (kidney, chickpea, black bean)', 'Feta 30g, lemon, herbs', '1 whole grain pita'], kcal: 420 },
        { meal: 'Snack',     foods: ['1 low-fat string cheese', '1 small orange'], kcal: 120 },
        { meal: 'Dinner',   foods: ['180g grilled shrimp', '2 cups zucchini noodles with tomato sauce', '1 tbsp parmesan'], kcal: 380 },
        { meal: 'Evening', foods: ['20g protein shake', '1 cup chamomile tea'], kcal: 100 },
      ],
    },
    {
      day: 'Saturday',
      meals: [
        { meal: 'Breakfast', foods: ['Veggie frittata (3 eggs, peppers, onion, mushroom)', '1 cup berries'], kcal: 370 },
        { meal: 'Lunch',     foods: ['Large tossed salad with 140g grilled chicken', 'Balsamic vinegar & olive oil', '10 whole grain crackers'], kcal: 450 },
        { meal: 'Snack',     foods: ['Greek yogurt (150g plain, low-fat)', '1 tsp honey'], kcal: 130 },
        { meal: 'Dinner',   foods: ['180g baked chicken breast', '1 cup roasted Brussels sprouts', '½ cup cauliflower rice'], kcal: 400 },
        { meal: 'Evening', foods: ['1 cup warm skim milk'], kcal: 90 },
      ],
    },
    {
      day: 'Sunday',
      meals: [
        { meal: 'Breakfast', foods: ['Whole grain banana pancakes (½ cup oats, 1 egg, 1 banana) — 3 small', '½ cup berries'], kcal: 390 },
        { meal: 'Lunch',     foods: ['Turkey & vegetable soup (150g turkey, carrots, celery, zucchini)', '1 slice sourdough'], kcal: 400 },
        { meal: 'Snack',     foods: ['1 celery stalk + 1 tbsp peanut butter', '1 small apple'], kcal: 170 },
        { meal: 'Dinner',   foods: ['180g cod with lemon & herbs', '2 cups steamed broccoli & cauliflower', '½ cup lentils'], kcal: 410 },
        { meal: 'Evening', foods: ['20g casein protein shake'], kcal: 80 },
      ],
    },
  ],
  disclaimer:
    'This plan creates a caloric deficit for safe, sustainable fat loss (0.5–1 kg/week). Rapid weight loss below 1,200 kcal/day is not recommended without medical supervision. Consult a physician or registered dietitian before starting.',
};

const LEAN_BODY_PLAN: GoalPlan = {
  id: 'lean_body',
  title: 'Lean Body (Recomp)',
  subtitle: 'Lose fat + gain muscle simultaneously',
  badge: '⚡',
  color: '#8B5CF6',
  rationale:
    'Body recomposition is achievable, especially in beginners and those returning after a break. Eating at maintenance calories (or slight +/- cycling), with very high protein (2.0–2.4 g/kg/day), supports simultaneous fat loss and muscle gain. Evidence from Barakat et al. (Strength & Conditioning Journal, 2020) and Longland et al. (AJCN 2016) supports this approach.',
  sources: [
    'Barakat et al. S&CJ (2020) — Body Recomposition: Can Trained Individuals Build Muscle and Lose Fat at the Same Time?',
    'Longland et al. AJCN (2016) — Higher protein during caloric restriction in resistance-trained men',
    'Antonio & Ellerbroek (2016) — High protein diet in trained women',
    'ISSN Position Stand (2017) — Protein and Exercise',
  ],
  calories: 2100,
  macros: { protein: 185, carbs: 220, fat: 62, fiber: 38 },
  rules: [
    'Eat at or near maintenance calories — small swings (+100 on training days, -100 on rest)',
    'Distribute 35–50 g protein every 3–4 hours for maximum MPS',
    'Cycle carbohydrates: higher on training days, lower on rest days',
    'Resistance train 4x per week minimum — progressive overload is essential',
    'Prioritize sleep: 8 hours optimizes both GH release and cortisol management',
    'Track for 4–6 weeks before judging results — recomp is slow but sustainable',
  ],
  weekPlan: [
    {
      day: 'Monday (Training Day — Higher Carb)',
      meals: [
        { meal: 'Breakfast (7 AM)', foods: ['1 cup oatmeal with protein powder mixed in', '1 banana', '2 boiled eggs', '1 tbsp almond butter'], kcal: 570 },
        { meal: 'Lunch (12 PM)',    foods: ['180g grilled chicken breast', '200g basmati rice', '1 cup steamed broccoli', '1 tbsp olive oil'], kcal: 640 },
        { meal: 'Pre-Workout (4 PM)', foods: ['1 banana', '30g whey protein shake'], kcal: 310 },
        { meal: 'Post-Workout Dinner (8 PM)', foods: ['180g lean beef (sirloin)', '1 cup mashed sweet potato', '1 cup green beans', '½ avocado'], kcal: 650 },
      ],
    },
    {
      day: 'Tuesday (Training Day — Higher Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['3-egg omelet with peppers, onion, spinach', '2 slices whole grain toast', '1 orange'], kcal: 540 },
        { meal: 'Lunch',     foods: ['150g tuna with 200g quinoa', 'Cucumber, tomato, lemon dressing', '1 cup edamame'], kcal: 620 },
        { meal: 'Pre-Workout', foods: ['Protein yogurt (200g Greek yogurt + 15g protein powder)', '1 rice cake'], kcal: 320 },
        { meal: 'Post-Workout Dinner', foods: ['180g salmon', '200g mixed roasted vegetables', '½ cup brown rice', '1 tbsp pesto'], kcal: 660 },
        { meal: 'Snack', foods: ['1 cup low-fat cottage cheese', '10 almonds'], kcal: 230 },
      ],
    },
    {
      day: 'Wednesday (Rest Day — Lower Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['4 scrambled eggs', '2 strips turkey bacon', 'Sautéed mushrooms & spinach', 'Coffee'], kcal: 480 },
        { meal: 'Lunch',     foods: ['Large chicken salad (180g chicken, romaine, avocado, feta 30g)', '1 tbsp olive oil & vinegar'], kcal: 510 },
        { meal: 'Snack',     foods: ['30g whey protein shake', '1 cup berries', '10 walnuts'], kcal: 290 },
        { meal: 'Dinner',   foods: ['180g grilled shrimp', '2 cups roasted broccoli & cauliflower', '½ cup lentils', '1 tbsp tahini'], kcal: 490 },
        { meal: 'Evening', foods: ['200g Greek yogurt', '1 tsp honey'], kcal: 160 },
      ],
    },
    {
      day: 'Thursday (Training Day — Higher Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['Smoothie bowl: 1 frozen banana, 30g protein, almond milk, berries, granola 30g'], kcal: 550 },
        { meal: 'Lunch',     foods: ['150g ground turkey taco bowl (black beans, rice, salsa, ¼ avocado, lime)'], kcal: 630 },
        { meal: 'Pre-Workout', foods: ['1 banana + 1 tbsp peanut butter', 'Black coffee (or pre-workout)'], kcal: 300 },
        { meal: 'Post-Workout Dinner', foods: ['180g pork tenderloin', '200g sweet potato wedges', '1 cup asparagus', '1 tsp coconut oil'], kcal: 650 },
        { meal: 'Snack', foods: ['1 cup warm milk', '30g casein protein'], kcal: 240 },
      ],
    },
    {
      day: 'Friday (Training Day — Higher Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['Egg white + whole egg scramble (3 whites, 2 whole)', '1 cup oatmeal', '½ cup blueberries'], kcal: 520 },
        { meal: 'Lunch',     foods: ['180g grilled chicken wrap (whole wheat, lettuce, tomato, hummus 2 tbsp)', '1 small banana'], kcal: 610 },
        { meal: 'Pre-Workout', foods: ['Protein shake (30g)', '2 dates'], kcal: 280 },
        { meal: 'Post-Workout Dinner', foods: ['180g baked cod', '1 cup quinoa', '2 cups roasted vegetables', '1 tbsp olive oil'], kcal: 630 },
        { meal: 'Snack', foods: ['Cottage cheese 200g', 'Pineapple chunks ½ cup'], kcal: 220 },
      ],
    },
    {
      day: 'Saturday (Active Recovery — Moderate Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['Protein pancakes (2 eggs, 1 banana, 30g protein powder)', '½ cup Greek yogurt', '1 cup berries'], kcal: 570 },
        { meal: 'Lunch',     foods: ['180g grilled salmon', '1 cup couscous', '1 cup roasted zucchini & peppers'], kcal: 640 },
        { meal: 'Snack',     foods: ['Hummus (4 tbsp) + veggie sticks (carrot, celery, cucumber)', '1 handful trail mix'], kcal: 280 },
        { meal: 'Dinner',   foods: ['180g baked chicken thigh (skinless)', '1 cup brown rice', '2 cups steamed green beans', 'Lemon & garlic'], kcal: 620 },
        { meal: 'Evening', foods: ['30g casein shake', '1 cup warm almond milk'], kcal: 230 },
      ],
    },
    {
      day: 'Sunday (Full Rest — Lower Carb)',
      meals: [
        { meal: 'Breakfast', foods: ['3 poached eggs', 'Avocado ½', '2 tomato slices', 'Whole grain toast x1'], kcal: 490 },
        { meal: 'Lunch',     foods: ['Large Greek salad (cucumber, tomato, olives, feta, grilled chicken 150g)'], kcal: 500 },
        { meal: 'Snack',     foods: ['Protein shake (30g)', '10 macadamia nuts'], kcal: 280 },
        { meal: 'Dinner',   foods: ['180g lean turkey mince bolognese (zucchini noodles)', '30g parmesan', '1 cup cherry tomatoes'], kcal: 530 },
        { meal: 'Evening', foods: ['200g cottage cheese', '5 walnut halves', '½ cup berries'], kcal: 240 },
      ],
    },
  ],
  disclaimer:
    'Body recomposition requires patience — allow 8–12 weeks to see measurable changes. Individual responses vary based on training age, genetics, and adherence. This plan is based on peer-reviewed literature. Always consult a registered dietitian or your physician before starting.',
};

// GET /nutrition/plans
export const getGoalPlans = (_req: Request, res: Response): void => {
  res.json({
    plans: [MUSCLE_GAIN_PLAN, FAT_LOSS_PLAN, LEAN_BODY_PLAN],
    meta: {
      lastUpdated: '2025',
      disclaimer: 'All plans are based on peer-reviewed sports nutrition guidelines (ISSN, ACSM, AND). They represent general population averages. Individual needs differ by body weight, activity level, age, sex, and medical history. Always consult a qualified healthcare professional before starting any nutrition program.',
    },
  });
};
