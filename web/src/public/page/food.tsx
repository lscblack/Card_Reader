import { Beef, Beer, CakeSlice, Carrot, Cherry, Citrus, Coffee, Cookie, CookingPot, Croissant, CupSoda, Donut, Drumstick, EggFried, Fish, GlassWater, Ham, IceCreamCone, Martini, Milk, Pizza, Popcorn, Salad, Sandwich, Shrimp, Soup, UtensilsCrossed, Wheat, Wine, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Keyword → icon, first match wins (so "chicken burger" is a burger, "iced coffee" is a coffee). */
const RULES: [RegExp, LucideIcon][] = [
  [/burger|slider/, Beef],
  [/pizza|calzone/, Pizza],
  [/cocktail|martini|mojito|margarita|negroni|spritz|daiquiri|cosmo|mule|sour|gin|vodka|rum|tequila|whisk|bourbon|scotch|cognac/, Martini],
  [/wine|champagne|prosecco|ros[ée]|merlot|cabernet|chardonnay|sauvignon/, Wine],
  [/beer|lager|ale\b|stout|ipa|pilsner|cider/, Beer],
  [/coffee|espresso|latte|cappuccino|americano|macchiato|mocha|flat white|cortado|tea\b|chai/, Coffee],
  [/milkshake|shake|smoothie|milk|lassi/, Milk],
  [/juice|lemonade|citrus|orange|lemon/, Citrus],
  [/soda|cola|coke|pepsi|fanta|sprite|soft drink|iced/, CupSoda],
  [/water|tonic|sparkling/, GlassWater],
  [/ice cream|gelato|sundae|sorbet/, IceCreamCone],
  [/donut|doughnut/, Donut],
  [/cake|brownie|tart|cheesecake|tiramisu|pie|brûlée|brulee|mousse|pudding|dessert|waffle|pancake/, CakeSlice],
  [/cookie|biscuit|macaron/, Cookie],
  [/croissant|pastry|bagel|muffin|scone|brioche|toast|bread/, Croissant],
  [/sandwich|panini|wrap|sub\b|club|hot ?dog|taco|burrito|quesadilla|shawarma|kebab/, Sandwich],
  [/chicken|wing|drumstick|nugget|poultry|duck/, Drumstick],
  [/shrimp|prawn|lobster|crab|calamari|squid|oyster|mussel|scallop/, Shrimp],
  [/fish|salmon|tuna|cod|tilapia|sushi|sashimi|maki|ceviche|sea ?bass/, Fish],
  [/steak|beef|brisket|ribs?\b|lamb|pork|goat|sirloin|filet|meat|bbq|grill/, Ham],
  [/egg|omelet|benedict|breakfast|shakshuka/, EggFried],
  [/soup|ramen|pho|broth|chowder|bisque|stew|curry/, Soup],
  [/salad|bowl|poke|greens|caesar|veg/, Salad],
  [/noodle|pasta|spaghetti|penne|lasagn|risotto|rice|biryani|pilau|pilaf|fried rice|pad thai/, CookingPot],
  [/fries|chips|wedges|popcorn|nachos/, Popcorn],
  [/carrot|side|plantain|potato|mash/, Carrot],
  [/fruit|berry|cherry|mango|apple/, Cherry],
  [/grain|oat|granola|porridge|cereal/, Wheat],
]

export function foodIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  return RULES.find(([re]) => re.test(n))?.[1] ?? UtensilsCrossed
}

/** Tile shown where a menu photo is missing: an icon picked from the item name, on the page's accent tint. */
export function FoodPlaceholder({ name, className }: { name: string; className?: string }) {
  const Icon = foodIcon(name)
  return (
    <div className={cn('pg-ph pg-food-ph', className)} aria-hidden="true">
      <Icon style={{ position: 'relative', zIndex: 1, width: '38%', height: '38%', maxWidth: 44, maxHeight: 44 }} strokeWidth={1.6} />
    </div>
  )
}
