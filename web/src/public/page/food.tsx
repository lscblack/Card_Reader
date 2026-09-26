import { createElement } from 'react'
import { Beef, Beer, Hamburger, CakeSlice, Carrot, Cherry, Citrus, Coffee, Cookie, CookingPot, Croissant, CupSoda, Donut, Drumstick, EggFried, Fish, GlassWater, IceCreamCone, Martini, Milk, Pizza, Popcorn, Salad, Sandwich, Shrimp, Soup, UtensilsCrossed, Wheat, Wine, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Keyword → icon, first match wins (so "chicken burger" is a burger, "iced coffee" is a coffee). */
const RULES: [RegExp, LucideIcon][] = [
  [/\b(?:burger|slider)/, Hamburger],
  [/\b(?:pizza|calzone)/, Pizza],
  [/\b(?:cocktail|martini|mojito|margarita|negroni|spritz|daiquiri|cosmo|mule|sour|gin|vodka|rum|tequila|whisk|bourbon|scotch|cognac)/, Martini],
  [/\b(?:wine|champagne|prosecco|ros[ée]|merlot|cabernet|chardonnay|sauvignon)/, Wine],
  [/\b(?:beer|lager|ale\b|stout|ipa|pilsner|cider)/, Beer],
  [/\b(?:coffee|espresso|latte|cappuccino|americano|macchiato|mocha|flat white|cortado|tea\b|chai)/, Coffee],
  [/\b(?:milkshake|shake|smoothie|milk|lassi)/, Milk],
  [/\b(?:juice|lemonade|citrus|orange|lemon)/, Citrus],
  [/\b(?:soda|cola|coke|pepsi|fanta|sprite|soft drink|iced)/, CupSoda],
  [/\b(?:water|tonic|sparkling)/, GlassWater],
  [/\b(?:ice cream|gelato|sundae|sorbet)/, IceCreamCone],
  [/\b(?:donut|doughnut)/, Donut],
  [/\b(?:cake|brownie|tart|cheesecake|tiramisu|pie|brûlée|brulee|mousse|pudding|dessert|waffle|pancake)/, CakeSlice],
  [/\b(?:cookie|biscuit|macaron)/, Cookie],
  [/\b(?:croissant|pastry|bagel|muffin|scone|brioche|toast|bread)/, Croissant],
  [/\b(?:sandwich|panini|wrap|sub\b|club|hot ?dog|taco|burrito|quesadilla|shawarma|kebab)/, Sandwich],
  [/\b(?:chicken|wing|drumstick|nugget|poultry|duck)/, Drumstick],
  [/\b(?:shrimp|prawn|lobster|crab|calamari|squid|oyster|mussel|scallop)/, Shrimp],
  [/\b(?:fish|salmon|tuna|cod|tilapia|sushi|sashimi|maki|ceviche|sea ?bass)/, Fish],
  [/\b(?:steak|sirloin|beef|brisket|ribs?\b|lamb|pork|goat|sirloin|filet|meat|bbq|grill)/, Beef],
  [/\b(?:egg|omelet|benedict|breakfast|shakshuka)/, EggFried],
  [/\b(?:soup|ramen|pho|broth|chowder|bisque|stew|curry)/, Soup],
  [/\b(?:salad|bowl|poke|greens|caesar|veg)/, Salad],
  [/\b(?:noodle|pasta|spaghetti|penne|lasagn|risotto|rice|biryani|pilau|pilaf|fried rice|pad thai)/, CookingPot],
  [/\b(?:fries|chips|wedges|popcorn|nachos)/, Popcorn],
  [/\b(?:carrot|side|plantain|potato|mash)/, Carrot],
  [/\b(?:fruit|berry|cherry|mango|apple)/, Cherry],
  [/\b(?:grain|oat|granola|porridge|cereal)/, Wheat],
]

function foodIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  return RULES.find(([re]) => re.test(n))?.[1] ?? UtensilsCrossed
}

/** Tile shown where a menu photo is missing: an icon picked from the item name, on the page's accent tint. */
export function FoodPlaceholder({ name, className }: { name: string; className?: string }) {
  return (
    <div className={cn('pg-ph pg-food-ph', className)} aria-hidden="true">
      {createElement(foodIcon(name), { style: { position: 'relative', zIndex: 1, width: '38%', height: '38%', maxWidth: 44, maxHeight: 44 }, strokeWidth: 1.6 })}
    </div>
  )
}
