"""Builds app/data/page_templates.json (and the web copy) from content packs × designs.

    python scripts/build_page_templates.py

The hand-written "core" templates already in the file are kept as they are; everything else is regenerated. Every
template is validated with the same loader the API uses, so a bad entry fails the build instead of being skipped.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
OUT = ROOT / "app/data/page_templates.json"
WEB = ROOT.parent / "web/src/business/data/page_templates.json"

CORE_IDS = {
    "menu_bistro_classic", "menu_cafe_chalkboard", "menu_modern_grid", "menu_fine_dining", "menu_bar_cocktails", "menu_street_food",
    "product_catalogue_grid", "product_single", "product_service_list", "links_hub", "links_creator", "offer_coupon",
    "offer_flash_sale", "event_invite", "event_workshop", "wifi_guest", "gallery_portfolio", "form_feedback", "form_contact",
    "form_booking",
}
MIN_PER_TYPE = 40

# ── palettes: (background, surface, text, accent, dark) ─────────────────────────
P = {
    "ember": ("#121212", "#1c1c1c", "#f5f5f5", "#f97316", True),
    "mustard": ("#141414", "#1f1f1f", "#f7f7f5", "#facc15", True),
    "crimson_noir": ("#0d0d0d", "#181818", "#f4f4f4", "#dc2626", True),
    "chalk": ("#23282b", "#2a3034", "#eef1f0", "#f59e0b", True),
    "slate_yellow": ("#2d3338", "#353c42", "#f2f2f2", "#fbbf24", True),
    "teal_gold": ("#0f2a2e", "#143539", "#f3efe2", "#d4a24c", True),
    "black_gold": ("#0c0c0c", "#161616", "#f3ede0", "#caa24a", True),
    "navy_gold": ("#0f1b2d", "#16243a", "#f1ede4", "#d6a84e", True),
    "mocha": ("#2b1d16", "#36251c", "#f6ebe0", "#d08b52", True),
    "neon_violet": ("#0b0714", "#150f24", "#f4f1ff", "#a855f7", True),
    "lime_night": ("#0b0c0f", "#15171c", "#f4f5f7", "#a3e635", True),
    "cream_terracotta": ("#f7efe2", "#fffaf2", "#2a1d14", "#b4532a", False),
    "kraft": ("#dcc39f", "#e9d6b8", "#3b2416", "#7a2e1b", False),
    "beige_red": ("#f4e6cf", "#fbf1e0", "#3a1d12", "#a3341f", False),
    "white_green": ("#ffffff", "#ffffff", "#16241c", "#0f6b3f", False),
    "white_red": ("#ffffff", "#ffffff", "#1d1414", "#9f1d20", False),
    "white_yellow": ("#fffdf6", "#ffffff", "#1c1a14", "#ca8a04", False),
    "grey_red": ("#efefef", "#ffffff", "#151515", "#c1121f", False),
    "cream_gingham": ("#fbf4e4", "#fffaf0", "#1a1a1a", "#3b6fd8", False),
    "blush": ("#fdf2f4", "#ffffff", "#2a1519", "#be185d", False),
    "forest": ("#f2f5ef", "#ffffff", "#172016", "#3f7d3a", False),
    "ocean": ("#f1f7fa", "#ffffff", "#0c1d26", "#0e7490", False),
    "sky": ("#f5f7fb", "#ffffff", "#0f172a", "#2563eb", False),
    "sand": ("#faf7f2", "#ffffff", "#1c1917", "#b45309", False),
    "mint": ("#f3f7f6", "#ffffff", "#10201d", "#0d9488", False),
    "lilac": ("#f6f3fb", "#ffffff", "#1d1629", "#7c3aed", False),
    "paper": ("#f6f6f3", "#ffffff", "#18181b", "#334155", False),
    "peach": ("#fff4ea", "#ffffff", "#1f1510", "#ea580c", False),
    "rose_night": ("#170c11", "#22131a", "#fbeff3", "#f472b6", True),
    "ink": ("#0f1115", "#181b21", "#eef0f3", "#38bdf8", True),
}

PRESET = {"popular", "new", "spicy", "vegetarian", "vegan", "gluten-free", "sold out"}
PRESET_ID = {"gluten-free": "gluten_free", "sold out": "sold_out"}

CONTACT = {"id": "contact", "type": "contact", "phone": "{{business.phone}}", "email": "{{business.email}}",
           "website": "{{business.website}}", "address": "{{business.address}}"}


def hours(open_="08:00", close="22:00", sunday=True):
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return {"id": "hours", "type": "hours", "rows": [
        {"day": d, "open": open_, "close": close, "closed": d == "Sunday" and not sunday} for d in days]}


def theme(pal, layout, font, header=None, radius=14):
    bg, surface, text, accent, dark = P[pal]
    t = {"accent": accent, "background": bg, "surface": surface, "text": text, "font": font, "layout": layout,
         "corner_radius": radius, "dark": dark}
    if header:
        t["header"] = header
    return t


def item(name, price, desc="", tags=()):
    out = {"name": name, "price": price}
    if desc:
        out["description"] = desc
    badges = [PRESET_ID.get(t.lower(), t.lower()) for t in tags if t.lower() in PRESET]
    custom = [t for t in tags if t.lower() not in PRESET]
    if badges:
        out["badges"] = badges
    if custom:
        out["tags"] = custom
    return out


# ── menu packs ─────────────────────────────────────────────────────────────────
# key: (name, category, intro, currency, [(category, note, [items])])
MENUS = {
    "burger": ("Burger joint", "Fast food", "Smash burgers, crispy fries and thick shakes — made to order.", "USD", [
        ("Burgers", "All burgers come on a toasted brioche bun.", [
            item("Classic smash", 9.49, "Double beef patty, cheddar, pickles, house sauce", ["Popular"]),
            item("Bacon BBQ", 11.49, "Smoked bacon, onion rings, BBQ glaze, cheddar"),
            item("Crispy chicken", 10.49, "Buttermilk fried chicken, slaw, chipotle mayo", ["Spicy"]),
            item("Black bean burger", 9.99, "Charred corn salsa, avocado, lime crema", ["Vegetarian"]),
        ]),
        ("Big burgers", "", [
            item("The Tower", 14.99, "Triple patty, triple cheese, crispy onions", ["Signature"]),
            item("Truffle mushroom", 13.49, "Swiss cheese, sautéed mushrooms, truffle mayo", ["New"]),
            item("Hot honey", 12.99, "Fried chicken, hot honey, pickled jalapeños", ["Spicy"]),
        ]),
        ("Sides & shakes", "", [
            item("Fries", 3.49, "Skin-on, sea salt", ["Vegan"]),
            item("Loaded fries", 5.99, "Cheese sauce, bacon bits, spring onion"),
            item("Vanilla milkshake", 4.99, "Real ice cream, whipped cream"),
            item("Chocolate milkshake", 4.99, "Belgian chocolate", ["Popular"]),
        ]),
    ]),
    "pizza": ("Pizzeria", "Italian", "Neapolitan-style pizza from a 450 °C wood oven. Dough rested 48 hours.", "USD", [
        ("Rosse", "Tomato base", [
            item("Margherita", 11, "San Marzano tomato, fior di latte, basil", ["Vegetarian", "Popular"]),
            item("Diavola", 14, "Spicy salami, chilli oil, mozzarella", ["Spicy"]),
            item("Capricciosa", 15, "Ham, artichoke, mushroom, olives"),
        ]),
        ("Bianche", "No tomato", [
            item("Quattro formaggi", 15, "Mozzarella, gorgonzola, parmesan, fontina", ["Vegetarian"]),
            item("Salsiccia e friarielli", 16, "Fennel sausage, broccoli rabe, smoked provola", ["Chef’s pick"]),
        ]),
        ("Dolci", "", [
            item("Tiramisù", 7, "Mascarpone, espresso, cocoa"),
            item("Nutella calzone", 8, "To share", ["Sharing"]),
        ]),
    ]),
    "cafe": ("Coffee house", "Café", "Specialty coffee, fresh pastries and slow mornings.", "USD", [
        ("Espresso bar", "Oat, almond and soy milk at no extra cost.", [
            item("Espresso", 3, "Double shot"),
            item("Flat white", 4.2, "Silky microfoam", ["Popular"]),
            item("Cappuccino", 4.2),
            item("Iced latte", 4.8, "", ["Iced"]),
        ]),
        ("Tea & more", "", [
            item("Chai latte", 4.5, "House-spiced masala chai"),
            item("Matcha latte", 5, "Ceremonial grade", ["New"]),
            item("Hot chocolate", 4.2),
        ]),
        ("Bakery", "Baked every morning.", [
            item("Butter croissant", 3.2, "", ["Vegetarian"]),
            item("Banana bread", 3.8, "Toasted, with salted butter"),
            item("Cinnamon bun", 3.9, "", ["Popular"]),
        ]),
    ]),
    "thai": ("Thai kitchen", "Asian", "Street-food favourites and slow-cooked curries — spice level on request.", "USD", [
        ("Appetizers", "", [
            item("Vegetable spring rolls", 6.5, "Sweet chilli dip", ["Vegan"]),
            item("Chicken satay", 7.5, "Peanut sauce, cucumber relish", ["Popular"]),
            item("Tom yum goong", 8.5, "Hot and sour prawn soup", ["Spicy"]),
        ]),
        ("Curry", "Served with jasmine rice.", [
            item("Green curry", 13.5, "Chicken, Thai basil, coconut", ["Spicy"]),
            item("Massaman curry", 14.5, "Slow-cooked beef, potato, peanuts", ["Signature"]),
            item("Red duck curry", 16, "Lychee, pineapple, cherry tomato"),
        ]),
        ("Noodles & rice", "", [
            item("Pad thai", 12.5, "Tamarind, peanuts, bean sprouts", ["Popular"]),
            item("Pad see ew", 12.5, "Wide noodles, Chinese broccoli"),
            item("Khao pad", 11, "Thai fried rice, fried egg"),
        ]),
    ]),
    "sushi": ("Sushi bar", "Asian", "Fish delivered daily. Omakase available at the counter.", "USD", [
        ("Nigiri", "Two pieces", [
            item("Salmon", 6, "", ["Popular"]),
            item("Tuna", 7),
            item("Yellowtail", 7.5, "Yuzu, jalapeño", ["Chef’s pick"]),
        ]),
        ("Maki", "Eight pieces", [
            item("California roll", 9, "Crab, avocado, cucumber"),
            item("Spicy tuna roll", 11, "Chilli mayo, tempura flakes", ["Spicy"]),
            item("Avocado roll", 7, "", ["Vegan"]),
        ]),
        ("Hot dishes", "", [
            item("Chicken katsu", 14, "Panko cutlet, curry sauce"),
            item("Miso soup", 3.5, "", ["Vegetarian"]),
            item("Edamame", 4.5, "Sea salt or chilli garlic", ["Vegan"]),
        ]),
    ]),
    "grill": ("Grill house", "Grill & BBQ", "Charcoal grill, local cuts and honest sides.", "RWF", [
        ("From the grill", "", [
            item("Beef brochette", 3500, "Two skewers, grilled plantain", ["Popular"]),
            item("Goat brochette", 3500, "Pili-pili on the side", ["Spicy"]),
            item("Half chicken", 7000, "Lemon, garlic, herbs"),
            item("Whole tilapia", 9000, "Grilled, with kachumbari", ["Signature"]),
        ]),
        ("Sides", "", [
            item("Chips", 1500, "", ["Vegan"]),
            item("Fried plantain", 1500, "", ["Vegan"]),
            item("Isombe", 2500, "Cassava leaves, peanut sauce", ["Local"]),
        ]),
        ("Drinks", "", [
            item("Fresh passion juice", 1500),
            item("Local beer", 1500),
            item("Soda", 800),
        ]),
    ]),
    "iftar": ("Iftar feast", "Middle Eastern", "Break your fast with dates, soups and slow-cooked mains.", "USD", [
        ("To break the fast", "", [
            item("Dates & laban", 4, "Medjool dates, chilled yoghurt drink"),
            item("Lentil soup", 6, "Cumin, lemon", ["Vegan"]),
            item("Fattoush", 7, "Crispy pita, sumac, pomegranate", ["Vegan"]),
        ]),
        ("Mains", "", [
            item("Chicken biryani", 12, "Saffron rice, fried onions", ["Halal", "Popular"]),
            item("Lamb ouzi", 18, "Slow-roast lamb, spiced rice, nuts", ["Halal", "Signature"]),
            item("Mixed grill", 16, "Kofta, shish tawook, lamb chop", ["Halal"]),
        ]),
        ("Sweets", "", [
            item("Kunafa", 7, "Warm cheese pastry, syrup", ["Popular"]),
            item("Qatayef", 6, "Walnut or cream"),
        ]),
    ]),
    "breakfast": ("Breakfast club", "Café", "All-day breakfast with free-range eggs and fresh juice.", "USD", [
        ("Breakfast", "", [
            item("American breakfast", 12, "Two eggs any style, bacon or sausage, hash browns, toast", ["Popular"]),
            item("Pancake stack", 10, "Buttermilk pancakes, maple syrup, berries"),
            item("Breakfast burrito", 11, "Scrambled eggs, cheese, peppers, salsa"),
            item("Shakshuka", 11, "Baked eggs, spiced tomato, feta, bread", ["Vegetarian"]),
        ]),
        ("Desserts", "", [
            item("Chocolate lava cake", 5), item("Cheesecake", 5), item("Fruit tart", 6),
        ]),
        ("Sides", "", [
            item("French fries", 4), item("Sweet potato fries", 5), item("Avocado", 3, "", ["Vegan"]),
        ]),
    ]),
    "cocktails": ("Cocktail bar", "Bar", "Classics done right and a few ideas of our own.", "USD", [
        ("Signature cocktails", "", [
            item("El Diablo", 12, "Tequila, cassis, ginger beer, lime", ["Signature"]),
            item("Monkey fashion", 13, "Banana-infused rum, demerara, bitters"),
            item("Tequila sunrise", 11, "Tequila, orange, grenadine"),
        ]),
        ("Classics", "", [
            item("Margarita", 11, "Tequila, triple sec, lime", ["Popular"]),
            item("Negroni", 12, "Gin, Campari, sweet vermouth"),
            item("Old fashioned", 12, "Bourbon, sugar, bitters"),
            item("Moscow mule", 10, "Vodka, ginger beer, lime"),
        ]),
        ("Zero proof", "", [
            item("Virgin mojito", 7, "Mint, lime, soda"),
            item("Shirley Temple", 6, "Ginger ale, grenadine, cherry"),
        ]),
    ]),
    "wine": ("Wine bar", "Bar", "Small producers, big flavours — by the glass or bottle.", "EUR", [
        ("Red", "Glass / bottle", [
            {"name": "House red", "price": 7, "variants": [{"label": "Glass", "price": 7}, {"label": "Bottle", "price": 28}]},
            {"name": "Pinot noir", "price": 9, "description": "Burgundy, light and silky", "variants": [{"label": "Glass", "price": 9}, {"label": "Bottle", "price": 38}]},
        ]),
        ("White & sparkling", "", [
            {"name": "Sauvignon blanc", "price": 8, "description": "Loire, crisp and citrusy", "variants": [{"label": "Glass", "price": 8}, {"label": "Bottle", "price": 32}]},
            item("Prosecco", 8, "By the glass", ["Popular"]),
        ]),
        ("To share", "", [
            item("Cheese board", 16, "Three cheeses, honey, walnuts", ["Sharing"]),
            item("Charcuterie", 18, "Cured meats, pickles, bread", ["Sharing"]),
        ]),
    ]),
    "juice": ("Juice & smoothie bar", "Café", "Cold-pressed, no added sugar, blended to order.", "KES", [
        ("Fresh juices", "", [
            item("Green detox", 450, "Kale, apple, cucumber, ginger", ["Vegan"]),
            item("Sunrise", 400, "Orange, carrot, turmeric", ["Popular"]),
            item("Watermelon mint", 380),
        ]),
        ("Smoothies", "", [
            item("Mango lassi", 420, "Mango, yoghurt, cardamom"),
            item("Berry blast", 480, "Mixed berries, banana, oat milk", ["Vegan"]),
            item("Peanut power", 500, "Banana, peanut butter, dates", ["New"]),
        ]),
        ("Bowls", "", [
            item("Açaí bowl", 750, "Granola, banana, honey", ["Popular"]),
            item("Tropical bowl", 700, "Pineapple, coconut, passion fruit", ["Vegan"]),
        ]),
    ]),
    "desserts": ("Dessert parlour", "Desserts", "Gelato churned daily and cakes worth the trip.", "USD", [
        ("Gelato", "One / two / three scoops", [
            {"name": "Gelato", "price": 4, "description": "Pistachio, stracciatella, salted caramel, mango sorbet",
             "variants": [{"label": "1 scoop", "price": 4}, {"label": "2 scoops", "price": 6}, {"label": "3 scoops", "price": 7.5}]},
        ]),
        ("Cakes", "", [
            item("Chocolate fudge cake", 6, "", ["Popular"]),
            item("Carrot cake", 5.5, "Cream cheese frosting"),
            item("Lemon tart", 5.5, "", ["New"]),
        ]),
        ("Drinks", "", [
            item("Affogato", 5, "Gelato drowned in espresso"),
            item("Milkshake", 5.5, "Any gelato flavour"),
        ]),
    ]),
    "indian": ("Indian kitchen", "Asian", "Tandoor-fired breads and curries cooked the long way.", "GBP", [
        ("Starters", "", [
            item("Onion bhaji", 5, "", ["Vegan"]),
            item("Chicken tikka", 7, "Tandoori spices, mint chutney", ["Popular"]),
            item("Samosa chaat", 6, "Chickpeas, yoghurt, tamarind", ["Vegetarian"]),
        ]),
        ("Curries", "", [
            item("Butter chicken", 13, "Tomato, butter, fenugreek", ["Popular"]),
            item("Lamb rogan josh", 15, "Kashmiri chilli, slow-cooked", ["Spicy"]),
            item("Chana masala", 11, "Chickpeas, ginger, garam masala", ["Vegan"]),
            item("Palak paneer", 12, "Spinach, cottage cheese", ["Vegetarian"]),
        ]),
        ("Rice & bread", "", [
            item("Garlic naan", 3.5), item("Pilau rice", 3.5, "", ["Vegan"]),
        ]),
    ]),
    "tacos": ("Taqueria", "Mexican", "Corn tortillas pressed to order, salsas made fresh every day.", "USD", [
        ("Tacos", "Three per order", [
            item("Al pastor", 10, "Marinated pork, pineapple", ["Popular"]),
            item("Carne asada", 11, "Grilled steak, onion, cilantro"),
            item("Baja fish", 11, "Beer-battered fish, cabbage, chipotle"),
            item("Hongos", 9, "Mushrooms, epazote, queso fresco", ["Vegetarian"]),
        ]),
        ("Plates", "", [
            item("Burrito", 12, "Rice, beans, cheese, your choice of filling"),
            item("Quesadilla", 9, "Oaxaca cheese, flour tortilla", ["Vegetarian"]),
        ]),
        ("Sides & drinks", "", [
            item("Chips & guacamole", 6, "", ["Vegan"]), item("Elote", 5, "Street corn, lime mayo, chilli"),
            item("Horchata", 4), item("Agua fresca", 4),
        ]),
    ]),
    "seafood": ("Seafood shack", "Seafood", "Straight off the boat — grilled, fried or raw.", "USD", [
        ("Raw bar", "", [
            item("Oysters", 18, "Half dozen, mignonette", ["Popular"]),
            item("Ceviche", 14, "Sea bass, lime, chilli, sweet potato", ["Spicy"]),
        ]),
        ("Mains", "", [
            item("Fish & chips", 16, "Beer batter, tartare sauce"),
            item("Grilled prawns", 22, "Garlic butter, herbs", ["Signature"]),
            item("Lobster roll", 26, "Brioche, lemon mayo", ["Limited"]),
        ]),
        ("Sides", "", [item("Fries", 4, "", ["Vegan"]), item("Coleslaw", 3.5, "", ["Vegetarian"])]),
    ]),
    "vegan": ("Plant kitchen", "Healthy", "100% plant-based, 100% delicious.", "EUR", [
        ("Bowls", "", [
            item("Buddha bowl", 12, "Quinoa, roasted veg, tahini", ["Vegan", "Popular"]),
            item("Poke bowl", 13, "Marinated tofu, edamame, seaweed", ["Vegan"]),
        ]),
        ("Burgers", "", [
            item("Beyond burger", 14, "Vegan cheddar, pickles, special sauce", ["Vegan"]),
            item("Falafel wrap", 10, "Hummus, pickled cabbage", ["Vegan"]),
        ]),
        ("Sweet", "", [item("Raw cacao slice", 5, "", ["Vegan", "Gluten-free"]), item("Oat latte", 4, "", ["Vegan"])]),
    ]),
    "bakery": ("Bakery", "Bakery", "Sourdough, viennoiserie and cakes, baked on site since dawn.", "EUR", [
        ("Bread", "", [
            item("Country sourdough", 6, "48-hour ferment", ["Popular"]),
            item("Baguette", 2.5), item("Seeded rye", 5.5, "", ["Vegan"]),
        ]),
        ("Viennoiserie", "", [
            item("Croissant", 2.2), item("Pain au chocolat", 2.5, "", ["Popular"]), item("Almond croissant", 3.2),
        ]),
        ("Cakes", "", [item("Lemon drizzle", 3.8), item("Carrot cake", 4.2), item("Brownie", 3.5, "", ["Gluten-free"])]),
    ]),
    "ramen": ("Ramen bar", "Asian", "Broths simmered for 18 hours, noodles made in house.", "USD", [
        ("Ramen", "", [
            item("Tonkotsu", 15, "Pork broth, chashu, soft egg", ["Popular"]),
            item("Spicy miso", 15, "Ground pork, chilli, corn", ["Spicy"]),
            item("Shoyu chicken", 14, "Clear soy broth, bamboo shoots"),
            item("Vegan tantan", 14, "Sesame, bok choy, tofu", ["Vegan"]),
        ]),
        ("Small plates", "", [
            item("Gyoza", 7, "Pork or vegetable"), item("Karaage", 8, "Japanese fried chicken"),
        ]),
        ("Drinks", "", [item("Ramune soda", 4), item("Green tea", 3)]),
    ]),
    "kids": ("Kids menu", "Family", "Little plates for little people — all with a drink and a treat.", "USD", [
        ("Mains", "", [
            item("Mini burger", 7, "With fries", ["Kids"]), item("Chicken nuggets", 7, "With fries", ["Kids", "Popular"]),
            item("Pasta pomodoro", 6, "", ["Vegetarian"]),
        ]),
        ("Treats", "", [item("Ice cream scoop", 2.5), item("Fruit cup", 3, "", ["Vegan"])]),
    ]),
    "steak": ("Steakhouse", "Grill & BBQ", "Dry-aged beef, cooked over oak.", "USD", [
        ("Steaks", "Served with one side and a sauce.", [
            item("Ribeye 300 g", 38, "Dry-aged 28 days", ["Signature"]),
            item("Sirloin 250 g", 32), item("Filet 200 g", 42, "", ["Chef’s pick"]),
        ]),
        ("Sides", "", [
            item("Creamed spinach", 6, "", ["Vegetarian"]), item("Truffle fries", 7), item("Mac & cheese", 7),
        ]),
        ("Sauces", "", [item("Peppercorn", 3), item("Béarnaise", 3), item("Chimichurri", 3, "", ["Vegan"])]),
    ]),
}

# Menu designs: layout → [(design name, palette, font, header, radius, show_images)]
MENU_DESIGNS = [
    ("menu-burger", "Ember", "ember", "geometric", "minimal", 16, True, ["burger", "tacos", "steak"]),
    ("menu-burger", "Mustard", "mustard", "condensed", "minimal", 14, True, ["pizza", "kids"]),
    ("menu-chalk-dinner", "Chalk", "chalk", "condensed", "logo", 10, False, ["grill", "breakfast"]),
    ("menu-chalk-dinner", "Slate", "slate_yellow", "condensed", "logo", 10, False, ["steak"]),
    ("menu-specials", "Sunshine", "white_yellow", "elegant", "cover", 14, True, ["breakfast", "bakery"]),
    ("menu-specials", "Rosé", "blush", "elegant", "cover", 18, True, ["desserts"]),
    ("menu-brush", "Brush yellow", "mustard", "condensed", "banner", 10, True, ["burger", "tacos"]),
    ("menu-brush", "Brush red", "crimson_noir", "condensed", "banner", 10, True, ["ramen"]),
    ("menu-gold", "Teal & gold", "teal_gold", "elegant", "logo", 4, False, ["breakfast", "wine"]),
    ("menu-gold", "Black & gold", "black_gold", "serif", "logo", 4, False, ["steak", "iftar"]),
    ("menu-arch", "Sand arch", "cream_terracotta", "serif", "logo", 20, False, ["iftar", "indian"]),
    ("menu-restaurant", "Evergreen", "white_green", "elegant", "minimal", 14, True, ["bakery", "vegan", "seafood"]),
    ("menu-diner", "Gingham", "cream_gingham", "humanist", "logo", 18, False, ["burger", "kids"]),
    ("menu-diner", "Cherry gingham", "white_red", "humanist", "logo", 18, False, ["pizza"]),
    ("menu-rustic", "Kraft", "kraft", "condensed", "logo", 8, True, ["grill", "pizza"]),
    ("menu-pattern", "Thai red", "white_red", "elegant", "logo", 6, False, ["thai", "indian"]),
    ("menu-pattern", "Saffron", "sand", "elegant", "logo", 6, False, ["sushi"]),
    ("menu-kraft", "Kraft & brick", "beige_red", "condensed", "banner", 12, True, ["breakfast", "juice"]),
    ("menu-numbered", "Big flavours", "ember", "condensed", "minimal", 10, False, ["burger", "tacos", "ramen"]),
    ("menu-lounge", "Lounge", "paper", "serif", "logo", 12, False, ["cocktails", "wine"]),
    ("menu-noir", "Noir", "crimson_noir", "geometric", "minimal", 6, False, ["cocktails"]),
    ("menu-cocktail", "Cocktail bars", "grey_red", "condensed", "logo", 0, True, ["cocktails", "juice"]),
    ("menu-fastfood-chalk", "Fast food chalk", "slate_yellow", "condensed", "minimal", 12, False, ["burger", "tacos"]),
    ("menu-grid", "Photo grid", "sand", "display", "cover", 16, True, ["sushi", "desserts", "vegan"]),
    ("menu-bistro", "Bistro", "cream_terracotta", "elegant", "logo", 6, False, ["wine", "seafood"]),
    ("menu-fine", "Fine dining", "navy_gold", "serif", "logo", 2, False, ["steak", "seafood"]),
    ("menu-bar", "Neon", "neon_violet", "display", "banner", 14, False, ["cocktails", "ramen"]),
    ("menu-street", "Street", "peach", "condensed", "banner", 10, False, ["tacos", "grill"]),
    ("menu-chalkboard", "Chalkboard", "chalk", "humanist", "minimal", 12, False, ["cafe", "juice"]),
    ("classic", "Classic", "mint", "sans", "cover", 16, True, ["cafe", "vegan"]),
    ("menu-burger", "Crimson", "crimson_noir", "geometric", "minimal", 16, True, ["steak"]),
    ("menu-specials", "Mint", "mint", "elegant", "cover", 14, True, ["juice"]),
    ("menu-restaurant", "Ocean", "ocean", "elegant", "minimal", 14, True, ["sushi"]),
    ("menu-lounge", "Midnight", "navy_gold", "serif", "logo", 12, False, ["wine"]),
    ("menu-numbered", "Mustard", "mustard", "condensed", "minimal", 10, False, ["pizza"]),
    ("menu-pattern", "Forest", "forest", "elegant", "logo", 6, False, ["vegan"]),
    ("menu-arch", "Mocha", "mocha", "serif", "logo", 20, False, ["cafe"]),
    ("menu-diner", "Sky", "sky", "humanist", "logo", 18, False, ["kids"]),
    ("menu-brush", "Violet", "neon_violet", "condensed", "banner", 10, True, ["cocktails"]),
    ("menu-grid", "Night", "ink", "display", "cover", 16, True, ["ramen"]),
]


def menu_template(pack_key, layout, dname, pal, font, header, radius, images):
    name, category, intro, currency, cats = MENUS[pack_key]
    secs = [
        {"id": "intro", "type": "text", "markdown": intro},
        {"id": "menu", "type": "menu", "currency": currency, "show_images": images,
         "categories": [{"name": c, **({"description": note} if note else {}), "items": items} for c, note, items in cats]},
        hours("11:00", "22:30"),
        CONTACT,
    ]
    return {
        "id": f"menu_{pack_key}_{layout.replace('menu-', '').replace('-', '_')}_{pal}"[:64],
        "page_type": "menu",
        "name": f"{name} · {dname}",
        "description": f"{intro} {LAYOUT_BLURB.get(layout, '')}".strip()[:300],
        "category": category,
        "preview_image_url": None,
        "theme": theme(pal, layout, font, header, radius),
        "sections": secs,
    }


LAYOUT_BLURB = {
    "menu-burger": "Round photos with price tags, like a burger flyer.",
    "menu-chalk-dinner": "Chalkboard boxes with centred headings.",
    "menu-specials": "Highlighted dish names with photos on the side.",
    "menu-brush": "Brush-stroke headings over two columns.",
    "menu-gold": "An ornate gold frame for an elegant evening.",
    "menu-arch": "Centred, two-column layout with fine headings.",
    "menu-restaurant": "Pill headings and a clean two-column list.",
    "menu-diner": "Gingham border and dotted price leaders.",
    "menu-rustic": "Kraft-paper look with photo thumbnails.",
    "menu-pattern": "Patterned border and a ruled price column.",
    "menu-kraft": "Kraft paper with bold price boxes.",
    "menu-numbered": "Numbered dishes and split-colour headings.",
    "menu-lounge": "Black pill headings, bar-menu style.",
    "menu-noir": "Wide-spaced headings on black, two columns.",
    "menu-cocktail": "Full-width black bars for each section.",
    "menu-fastfood-chalk": "Hand-written chalk look for fast food.",
    "menu-grid": "Photo cards in a grid.",
    "menu-bistro": "Paper texture with dotted price leaders.",
    "menu-fine": "Quiet, centred fine-dining typography.",
    "menu-bar": "Glowing neon headings.",
    "menu-street": "Loud, outlined street-food style.",
    "menu-chalkboard": "Classic café chalkboard.",
}


# ── products & services ───────────────────────────────────────────────────────
def prod(title, price, desc="", badge=None, was=None, stock=True):
    p = {"title": title, "description": desc, "price": price, "in_stock": stock, "cta": {"label": "Buy now", "url": "{{business.website}}"}}
    if badge:
        p["badge"] = badge
    if was is not None:
        p["compare_at_price"] = was
    return p


def svc(title, desc, price=None, duration=None):
    s = {"title": title, "description": desc}
    if price is not None:
        s["price"] = price
    if duration:
        s["duration"] = duration
    return s


PRODUCTS = {
    "boutique": ("Fashion boutique", "Retail", "New season, limited runs. Free alterations in store.", "USD", "products", [
        prod("Linen shirt", 49, "Relaxed fit, stone-washed", "New"), prod("Wide-leg trousers", 69, "High waist, pleated"),
        prod("Knit cardigan", 59, "Merino blend", "Sale", 79), prod("Leather belt", 29, "Full-grain, brass buckle")]),
    "beans": ("Coffee roaster", "Food & drink", "Roasted weekly in small batches.", "USD", "products", [
        prod("House blend 250 g", 14, "Chocolate, caramel, hazelnut", "Best seller"), prod("Ethiopia Yirgacheffe", 18, "Jasmine, bergamot"),
        prod("Decaf Colombia", 15, "Swiss-water process"), prod("Pour-over kit", 45, "Dripper, filters, scoop", "Gift idea")]),
    "beauty": ("Beauty shop", "Retail", "Clean skincare and cosmetics, cruelty-free.", "EUR", "products", [
        prod("Vitamin C serum", 32, "Brightening, 30 ml", "Popular"), prod("Daily SPF 50", 24, "Invisible finish"),
        prod("Lip tint", 16, "Four shades"), prod("Face mask set", 28, "Three masks", "Sale", 36)]),
    "tech": ("Gadget store", "Electronics", "Official warranty on everything we sell.", "USD", "products", [
        prod("Wireless earbuds", 59, "30-hour battery", "Sale", 89), prod("Power bank 20 000 mAh", 39, "Fast charge"),
        prod("Smart watch", 129, "Heart rate, GPS", "New"), prod("USB-C cable", 12, "2 m, braided")]),
    "books": ("Bookshop", "Retail", "Hand-picked reads and staff favourites.", "GBP", "products", [
        prod("Staff pick of the month", 14, "Ask us why we love it", "Staff pick"), prod("Children’s picture book", 9),
        prod("Cookbook", 25, "Hardback"), prod("Gift card", 20, "Any amount in store")]),
    "florist": ("Florist", "Retail", "Seasonal bouquets, same-day delivery before 2 pm.", "USD", "products", [
        prod("Seasonal bouquet", 45, "Florist’s choice", "Popular"), prod("Rose dozen", 60, "Red, white or pink"),
        prod("Potted orchid", 38), prod("Wedding consultation", "Free", "By appointment")]),
    "plants": ("Plant shop", "Retail", "Healthy plants, repotting and care advice.", "KES", "products", [
        prod("Monstera", 3500, "Medium, 60 cm", "Best seller"), prod("Snake plant", 1800, "Low light hero"),
        prod("Ceramic pot", 1200), prod("Plant food", 600)]),
    "furniture": ("Furniture studio", "Home", "Solid wood, made to order.", "USD", "products", [
        prod("Oak dining table", 890, "6 seats", "Made to order"), prod("Lounge chair", 420),
        prod("Side table", 180, "", "Sale", 220), prod("Bookshelf", 360)]),
    "jewelry": ("Jewellery", "Retail", "Handmade in small batches.", "USD", "products", [
        prod("Gold hoops", 79, "14k plated", "Popular"), prod("Pearl necklace", 120),
        prod("Signet ring", 95, "Engraving included"), prod("Charm bracelet", 65)]),
    "bakery_shop": ("Bakery shop", "Food & drink", "Order ahead, collect warm.", "EUR", "products", [
        prod("Sourdough loaf", 6, "", "Popular"), prod("Birthday cake", 35, "Order 48 h ahead"),
        prod("Cookie box", 12, "Six cookies"), prod("Granola jar", 8)]),
    "salon": ("Hair salon", "Services", "Friendly experts, honest prices.", "USD", "services", [
        svc("Haircut & style", "Wash, cut and finish.", 35, "45 min"), svc("Colour", "Full colour or roots.", 60, "90 min"),
        svc("Blow-dry", "Wash and style.", 25, "30 min"), svc("Treatment", "Deep-conditioning mask.", 20, "20 min")]),
    "spa": ("Spa & massage", "Wellness", "Switch off for an hour.", "USD", "services", [
        svc("Swedish massage", "Full body, relaxing.", 70, "60 min"), svc("Deep tissue", "Targets tension.", 85, "60 min"),
        svc("Facial", "Cleanse, exfoliate, mask.", 60, "50 min"), svc("Couples package", "Side by side.", 150, "90 min")]),
    "garage": ("Auto repair", "Services", "Honest quotes, no surprises.", "USD", "services", [
        svc("Oil change", "Oil and filter.", 49, "30 min"), svc("Brake service", "Pads and inspection.", 120, "90 min"),
        svc("Diagnostics", "Full computer scan.", 40, "30 min"), svc("Tyre fitting", "Per tyre, balancing included.", 15)]),
    "cleaning": ("Cleaning service", "Services", "Vetted cleaners, eco products.", "USD", "services", [
        svc("Standard clean", "Up to 2 bedrooms.", 80, "3 h"), svc("Deep clean", "Kitchen, bathrooms, inside cupboards.", 160, "6 h"),
        svc("Move-out clean", "Deposit-back guarantee.", 220), svc("Office clean", "Per visit, quote on request.")]),
    "fitness": ("Personal trainer", "Fitness", "Get strong, stay consistent.", "USD", "services", [
        svc("1:1 session", "Tailored workout.", 50, "60 min"), svc("10-session pack", "Save 20%.", 400),
        svc("Online plan", "Monthly programme and check-ins.", 90), svc("Nutrition review", "Food diary feedback.", 40, "45 min")]),
    "tutoring": ("Tutoring", "Education", "Patient, qualified tutors for every level.", "USD", "services", [
        svc("Maths", "Primary to A-level.", 30, "60 min"), svc("English", "Reading, writing, exams.", 30, "60 min"),
        svc("Coding for kids", "Scratch and Python.", 35, "60 min"), svc("Exam prep", "Intensive weekend.", 120)]),
    "pets": ("Pet grooming", "Services", "Gentle grooming for dogs and cats.", "USD", "services", [
        svc("Small dog groom", "Bath, cut, nails.", 45, "60 min"), svc("Large dog groom", "Bath, cut, nails.", 70, "90 min"),
        svc("Nail trim", "Quick and calm.", 12, "15 min"), svc("Cat groom", "Brush and bath.", 55)]),
    "photo": ("Photography", "Creative", "Portraits, products and events.", "USD", "services", [
        svc("Portrait session", "1 hour, 15 edited photos.", 150), svc("Product shoot", "Per product.", 25),
        svc("Event coverage", "Half day.", 400), svc("Headshots", "Team rate available.", 90)]),
    "laundry": ("Laundry", "Services", "Wash, dry, fold — ready in 24 hours.", "RWF", "services", [
        svc("Wash & fold", "Per kg.", 1500), svc("Shirt ironing", "Per piece.", 700),
        svc("Dry cleaning", "Suits and dresses.", 5000), svc("Express", "Same day.", 3000)]),
    "phone_repair": ("Phone repair", "Electronics", "Most repairs in under an hour.", "USD", "services", [
        svc("Screen replacement", "iPhone and Android.", 89, "45 min"), svc("Battery replacement", "", 49, "30 min"),
        svc("Water damage", "Diagnostics and clean.", 39), svc("Data recovery", "Quote after inspection.")]),
}

PRODUCT_DESIGNS = [  # (layout, font, radius, palettes) — combined round-robin into unique looks
    ("catalogue-grid", "sans", 14, ["sky", "paper", "ink", "mint"]),
    ("product-single", "elegant", 18, ["sand", "blush", "black_gold"]),
    ("service-list", "humanist", 14, ["mint", "ocean", "forest"]),
    ("product-boutique", "serif", 8, ["cream_terracotta", "beige_red", "blush"]),
    ("product-tech", "display", 14, ["ink", "neon_violet", "lime_night"]),
    ("product-bold", "condensed", 10, ["peach", "white_yellow", "mustard"]),
    ("service-elegant", "elegant", 6, ["navy_gold", "sand", "teal_gold"]),
    ("service-studio", "geometric", 12, ["lilac", "sky", "paper"]),
    ("menu-grid", "display", 16, ["forest", "peach"]),
]


def product_template(key, design):
    name, category, intro, currency, kind, items = PRODUCTS[key]
    layout, dname, pal, font, header, radius = design
    if kind == "products":
        main = {"id": "products", "type": "products", "currency": currency, "items": items}
    else:
        main = {"id": "services", "type": "services", "title": "Prices", "items": items}
    secs = [{"id": "intro", "type": "text", "markdown": intro}, main]
    if kind == "services":
        secs.append({"id": "book", "type": "links", "items": [{"label": "Book now", "url": "{{business.website}}", "icon": "link", "highlight": True}]})
    secs += [hours("09:00", "18:00", False), CONTACT]
    return {"id": f"product_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "product", "name": f"{name} · {dname}",
            "description": intro, "category": category, "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── links ─────────────────────────────────────────────────────────────────────
def link(label, url, icon="link", highlight=False):
    out = {"label": label, "url": url, "icon": icon}
    if highlight:
        out["highlight"] = True
    return out


SOCIAL = [link("Instagram", "https://instagram.com/", "instagram"), link("Facebook", "https://facebook.com/", "facebook")]
LINKS = {
    "restaurant": ("Restaurant", "Food & drink", "Book a table, see the menu or order in.", [link("Book a table", "{{business.website}}", "link", True), link("See the menu", "{{business.website}}"), link("Order delivery", "{{business.website}}"), *SOCIAL]),
    "cafe": ("Café", "Food & drink", "Coffee, cake and good company.", [link("Today’s menu", "{{business.website}}", "link", True), link("Find us", "https://www.google.com/maps", "map"), *SOCIAL]),
    "salon": ("Salon", "Beauty", "Book your next appointment in seconds.", [link("Book online", "{{business.website}}", "link", True), link("Price list", "{{business.website}}"), link("WhatsApp us", "https://wa.me/", "whatsapp"), SOCIAL[0]]),
    "musician": ("Musician", "Creators", "New single out now.", [link("Listen on Spotify", "https://open.spotify.com/", "link", True), link("Watch the video", "https://youtube.com/", "youtube"), link("Tour dates", "{{business.website}}"), link("TikTok", "https://tiktok.com/", "tiktok")]),
    "podcast": ("Podcast", "Creators", "New episodes every Monday.", [link("Latest episode", "https://open.spotify.com/", "link", True), link("YouTube", "https://youtube.com/", "youtube"), link("Support the show", "{{business.website}}")]),
    "church": ("Community", "Community", "Everyone is welcome.", [link("Service times", "{{business.website}}", "link", True), link("Watch live", "https://youtube.com/", "youtube"), link("Give", "{{business.website}}"), link("Find us", "https://www.google.com/maps", "map")]),
    "school": ("School", "Education", "Admissions, calendar and news.", [link("Admissions", "{{business.website}}", "link", True), link("Term calendar", "{{business.website}}"), link("Contact the office", "mailto:hello@example.com", "email"), SOCIAL[1]]),
    "gym": ("Gym", "Fitness", "Train with us — first class free.", [link("Class timetable", "{{business.website}}", "link", True), link("Join now", "{{business.website}}"), SOCIAL[0], link("TikTok", "https://tiktok.com/", "tiktok")]),
    "hotel": ("Hotel", "Hospitality", "Everything you need during your stay.", [link("Book direct — best rate", "{{business.website}}", "link", True), link("Room service menu", "{{business.website}}"), link("Directions", "https://www.google.com/maps", "map")]),
    "shop": ("Online shop", "Retail", "Shop our latest drop.", [link("Shop now", "{{business.website}}", "link", True), link("New arrivals", "{{business.website}}"), *SOCIAL]),
    "photographer": ("Photographer", "Creators", "Portraits, weddings and brands.", [link("Portfolio", "{{business.website}}", "link", True), link("Book a shoot", "mailto:hello@example.com", "email"), SOCIAL[0]]),
    "ngo": ("Non-profit", "Community", "Help us make a difference.", [link("Donate", "{{business.website}}", "link", True), link("Volunteer", "{{business.website}}"), link("Our impact", "{{business.website}}"), SOCIAL[1]]),
    "tours": ("Tour operator", "Travel", "Gorillas, lakes and city tours.", [link("Browse tours", "{{business.website}}", "link", True), link("WhatsApp us", "https://wa.me/", "whatsapp"), link("Reviews", "https://www.google.com/maps", "map"), SOCIAL[0]]),
    "realestate": ("Real estate", "Property", "Find your next home.", [link("Listings", "{{business.website}}", "link", True), link("Book a viewing", "{{business.website}}")]),
    "clinic": ("Clinic", "Health", "Care close to home.", [link("Book an appointment", "{{business.website}}", "link", True), link("Opening hours", "{{business.website}}"), link("Directions", "https://www.google.com/maps", "map")]),
    "bar": ("Bar", "Food & drink", "Cocktails, DJs and late nights.", [link("Tonight’s events", "{{business.website}}", "link", True), link("Drinks menu", "{{business.website}}"), SOCIAL[0], link("TikTok", "https://tiktok.com/", "tiktok")]),
    "dj": ("DJ", "Creators", "Bookings open for weddings and events.", [link("Book me", "mailto:hello@example.com", "email", True), link("Latest mix", "https://open.spotify.com/", "link"), SOCIAL[0]]),
    "artist": ("Artist", "Creators", "Original work and prints.", [link("Shop prints", "{{business.website}}", "link", True), link("Commissions", "mailto:hello@example.com", "email"), SOCIAL[0]]),
    "coach": ("Coach", "Services", "1:1 coaching to get unstuck.", [link("Free intro call", "{{business.website}}", "link", True), link("Testimonials", "{{business.website}}"), link("LinkedIn", "https://linkedin.com/", "linkedin")]),
    "venue": ("Event venue", "Events", "Weddings, conferences and parties.", [link("Check availability", "{{business.website}}", "link", True), link("Virtual tour", "https://youtube.com/", "youtube")]),
}
LINK_DESIGNS = [
    ("link-hub", "sans", 14, ["paper", "sky", "mint"]),
    ("link-creator", "display", 22, ["lime_night", "neon_violet", "rose_night"]),
    ("link-glass", "geometric", 18, ["neon_violet", "ink", "teal_gold"]),
    ("link-paper", "elegant", 10, ["cream_terracotta", "sand", "blush"]),
    ("link-bold", "condensed", 8, ["peach", "white_yellow", "mustard"]),
    ("link-minimal", "sans", 12, ["white_green", "grey_red", "lilac"]),
    ("link-cover", "humanist", 18, ["ocean", "forest", "mocha"]),
]


def links_template(key, design):
    name, category, bio, items = LINKS[key]
    layout, dname, pal, font, header, radius = design
    secs = [{"id": "bio", "type": "text", "markdown": bio}, {"id": "links", "type": "links", "items": items}, CONTACT]
    return {"id": f"links_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "links", "name": f"{name} · {dname}",
            "description": f"Link page for a {name.lower()}: {bio}", "category": category, "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── offers ────────────────────────────────────────────────────────────────────
OFFERS = {
    "welcome": ("Welcome discount", "15% off your first order", "15% OFF", "WELCOME15", "Thanks for tapping! Use this code on your first visit."),
    "happy_hour": ("Happy hour", "2-for-1 cocktails, 5–7 pm", "2 FOR 1", "HAPPY", "Every weekday. Show this page at the bar."),
    "birthday": ("Birthday treat", "A free dessert on your birthday", "FREE DESSERT", "BDAY", "Valid during your birthday week with ID."),
    "loyalty": ("Loyalty reward", "Your 10th coffee is on us", "FREE COFFEE", "LOYAL10", "Collect a stamp with every visit."),
    "black_friday": ("Black Friday", "Up to 60% off storewide", "UP TO 60%", "BLACK60", "This weekend only, in store and online."),
    "lunch": ("Lunch deal", "Main + drink for a fixed price", "LUNCH DEAL", "LUNCH", "Monday to Friday, 12–3 pm."),
    "referral": ("Refer a friend", "Give 20%, get 20%", "20% EACH", "FRIEND20", "Share this code — you both save."),
    "student": ("Student discount", "10% off with a valid student ID", "10% OFF", "STUDENT10", "Show your student card at checkout."),
    "first_class": ("First class free", "Try any class on us", "FREE CLASS", "TRYUS", "New members only. Book online."),
    "free_delivery": ("Free delivery", "No delivery fee this week", "FREE DELIVERY", "SHIPFREE", "On orders over $30."),
    "bundle": ("Bundle & save", "Buy 3, get the cheapest free", "3 FOR 2", "BUNDLE", "Mix and match across the store."),
    "early_bird": ("Early bird", "Book before Friday and save", "EARLY BIRD", "EARLY", "Limited spots at this price."),
    "clearance": ("Clearance", "Last pieces — final prices", "–50%", "LAST50", "While stocks last. No returns on clearance."),
    "family": ("Family deal", "Kids eat free on Sundays", "KIDS FREE", "FAMILY", "One kids’ meal per paying adult."),
    "anniversary": ("Anniversary sale", "Celebrating with 25% off", "25% OFF", "ANNIV25", "Thank you for being with us."),
    "new_menu": ("New menu launch", "Try the new menu, 20% off", "20% OFF", "NEWMENU", "First two weeks only."),
    "spa_day": ("Spa day", "Massage + facial package", "SAVE $40", "SPADAY", "Weekdays only, book ahead."),
    "flash": ("Flash sale", "48-hour flash sale", "48H ONLY", "FLASH", "Online and in store."),
    "rainy_day": ("Rainy day", "Hot drinks half price when it rains", "½ PRICE", "RAINY", "Automatically applied at the till."),
    "holiday": ("Holiday special", "Gift cards with a 10% bonus", "+10% BONUS", "GIFT10", "Perfect last-minute present."),
}
OFFER_DESIGNS = [
    ("offer-coupon", "display", 18, ["peach", "mint", "sky"]),
    ("offer-flash", "condensed", 10, ["mustard", "crimson_noir", "lime_night"]),
    ("offer-poster", "geometric", 14, ["ember", "white_red", "neon_violet"]),
    ("offer-ticket", "elegant", 8, ["cream_terracotta", "sand", "blush"]),
    ("offer-neon", "display", 16, ["neon_violet", "rose_night", "ink"]),
    ("offer-minimal", "serif", 4, ["navy_gold", "paper", "black_gold"]),
    ("offer-kraft", "condensed", 12, ["kraft", "beige_red"]),
    ("offer-gingham", "humanist", 18, ["cream_gingham", "white_red"]),
]


def offer_template(key, design):
    name, title, label, code, desc = OFFERS[key]
    layout, dname, pal, font, header, radius = design
    secs = [{"id": "offer", "type": "offer", "title": title, "discount_label": label, "description": desc, "code": code,
             "valid_until": "2026-12-31", "terms": "One use per customer. Cannot be combined with other offers.",
             "cta": {"label": "Redeem online", "url": "{{business.website}}"}}, CONTACT]
    return {"id": f"offer_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "offer", "name": f"{name} · {dname}",
            "description": f"{title}. {desc}", "category": "Promotions", "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── events ────────────────────────────────────────────────────────────────────
EVENTS = {
    "launch": ("Product launch", "Launch night at {{business.name}}", "2026-11-12T18:00:00", "Be the first to see what we’ve been building."),
    "wine_tasting": ("Wine tasting", "Autumn wine tasting", "2026-10-24T19:00:00", "Six wines, three producers, one great evening."),
    "workshop": ("Workshop", "Hands-on workshop", "2026-11-07T10:00:00", "Small group, beginner friendly, materials included."),
    "concert": ("Live music", "Live on Friday", "2026-10-30T20:30:00", "An acoustic set in an intimate room."),
    "gala": ("Gala dinner", "Annual gala dinner", "2026-12-05T19:00:00", "Black tie, four courses, and a good cause."),
    "open_day": ("Open day", "Open day", "2026-11-14T10:00:00", "Tour the space, meet the team, ask anything."),
    "yoga": ("Yoga retreat", "Sunrise yoga retreat", "2026-11-22T06:30:00", "Flow, breathwork and a healthy breakfast."),
    "conference": ("Conference", "Community tech meetup", "2026-11-19T17:30:00", "Talks, demos and networking."),
    "wedding": ("Wedding", "Our wedding", "2026-12-12T14:00:00", "We can’t wait to celebrate with you."),
    "birthday": ("Birthday party", "Birthday party", "2026-11-01T16:00:00", "Cake, games and good friends."),
    "market": ("Pop-up market", "Weekend pop-up market", "2026-11-08T09:00:00", "Local makers, food trucks and music."),
    "class": ("Cooking class", "Cooking class", "2026-11-15T15:00:00", "Cook three dishes and eat them together."),
    "quiz": ("Quiz night", "Pub quiz night", "2026-10-29T19:30:00", "Teams of up to six. Prizes for the winners."),
    "run": ("Fun run", "5K charity fun run", "2026-11-29T07:00:00", "All paces welcome — medals for everyone."),
    "exhibition": ("Exhibition", "Art exhibition opening", "2026-11-06T18:00:00", "Meet the artists over drinks."),
    "webinar": ("Webinar", "Free webinar", "2026-11-18T12:00:00", "45 minutes, live Q&A at the end."),
    "fundraiser": ("Fundraiser", "Charity fundraiser", "2026-12-01T18:30:00", "Auction, dinner and speeches."),
    "graduation": ("Graduation", "Graduation ceremony", "2026-12-10T10:00:00", "Celebrating the class of 2026."),
    "tasting_menu": ("Chef’s table", "Chef’s table evening", "2026-11-26T19:30:00", "Seven courses cooked in front of you."),
    "kids_day": ("Family fun day", "Family fun day", "2026-11-21T11:00:00", "Face painting, bouncy castle and food."),
}
EVENT_DESIGNS = [
    ("event-invite", "serif", 16, ["blush", "sand", "cream_terracotta"]),
    ("event-workshop", "geometric", 12, ["sky", "mint", "paper"]),
    ("event-gala", "elegant", 4, ["black_gold", "navy_gold", "teal_gold"]),
    ("event-neon", "display", 16, ["neon_violet", "ink", "rose_night"]),
    ("event-poster", "condensed", 10, ["peach", "mustard", "ember"]),
    ("event-minimal", "serif", 6, ["paper", "lilac", "white_green"]),
    ("event-garden", "elegant", 18, ["forest", "blush", "sand"]),
]


def event_template(key, design):
    name, title, start, desc = EVENTS[key]
    layout, dname, pal, font, header, radius = design
    end = start[:11] + f"{min(int(start[11:13]) + 3, 23):02d}" + start[13:]
    secs = [
        {"id": "event", "type": "event", "title": title, "starts_at": start, "ends_at": end, "venue": "{{business.name}}",
         "address": "{{business.address}}", "map_query": "{{business.address}}", "description": desc},
        {"id": "rsvp", "type": "form", "title": "RSVP", "description": "Let us know if you’re coming.", "fields": [
            {"id": "name", "label": "Your name", "type": "text", "required": True},
            {"id": "email", "label": "Email", "type": "email", "required": True},
            {"id": "guests", "label": "Guests", "type": "select", "required": True, "options": ["Just me", "+1", "+2", "+3"]},
        ], "submit_label": "Send RSVP", "success_message": "Thanks — see you there!"},
        CONTACT,
    ]
    return {"id": f"event_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "event", "name": f"{name} · {dname}",
            "description": desc, "category": "Events", "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── galleries ─────────────────────────────────────────────────────────────────
GALLERIES = {
    "photographer": ("Photographer", "Creative", "Portraits, weddings and brand work."),
    "interiors": ("Interior design", "Home", "Spaces we’ve designed and built."),
    "architecture": ("Architecture", "Creative", "Selected residential and commercial projects."),
    "tattoo": ("Tattoo studio", "Beauty", "Fine-line, blackwork and colour."),
    "bakery": ("Cake designer", "Food & drink", "Custom cakes for every occasion."),
    "florist": ("Florist", "Retail", "Bouquets, weddings and installations."),
    "hair": ("Hair stylist", "Beauty", "Cuts, colour and bridal styling."),
    "nails": ("Nail artist", "Beauty", "Gel, acrylic and nail art."),
    "carpentry": ("Carpentry", "Home", "Handmade furniture and fitted joinery."),
    "fashion": ("Fashion label", "Retail", "Lookbook — this season."),
    "hotel": ("Hotel", "Hospitality", "Rooms, pool and restaurant."),
    "restaurant": ("Restaurant", "Food & drink", "A look inside our kitchen and dining room."),
    "events": ("Event planner", "Events", "Weddings and parties we’ve planned."),
    "art": ("Artist", "Creative", "Paintings and prints — available on request."),
    "landscaping": ("Landscaping", "Home", "Gardens we’ve transformed."),
    "cars": ("Car detailing", "Services", "Before and after."),
    "gym": ("Gym", "Fitness", "Our space and equipment."),
    "school": ("School", "Education", "Campus life."),
    "travel": ("Tour operator", "Travel", "Moments from our trips."),
    "jewelry": ("Jeweller", "Retail", "Handmade pieces."),
}
GALLERY_DESIGNS = [
    ("gallery-portfolio", "elegant", 4, ["paper", "sand", "lilac"]),
    ("gallery-dark", "geometric", 2, ["ink", "black_gold", "crimson_noir"]),
    ("gallery-frame", "serif", 4, ["teal_gold", "navy_gold", "cream_terracotta"]),
    ("gallery-paper", "elegant", 10, ["kraft", "blush", "beige_red"]),
    ("gallery-cover", "display", 16, ["ocean", "forest", "peach"]),
    ("classic", "humanist", 16, ["mint", "sky"]),
]


def gallery_template(key, design):
    name, category, intro = GALLERIES[key]
    layout, dname, pal, font, header, radius = design
    secs = [{"id": "intro", "type": "text", "markdown": intro}, {"id": "gallery", "type": "gallery", "images": []},
            {"id": "links", "type": "links", "items": [link("Get in touch", "mailto:hello@example.com", "email", True), SOCIAL[0]]}]
    return {"id": f"gallery_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "gallery", "name": f"{name} · {dname}",
            "description": f"{intro} Add your photos to the gallery.", "category": category, "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── forms ─────────────────────────────────────────────────────────────────────
def f(id_, label, type_, required=False, options=None, placeholder=None):
    out = {"id": id_, "label": label, "type": type_, "required": required}
    if options:
        out["options"] = options
    if placeholder:
        out["placeholder"] = placeholder
    return out


NAME, EMAIL, PHONE = f("name", "Name", "text", True), f("email", "Email", "email", True), f("phone", "Phone", "phone")
FORMS = {
    "feedback": ("Quick feedback", "Feedback", "How was your visit?", [f("overall", "Overall", "rating", True), f("comments", "Comments", "textarea")], "Send"),
    "nps": ("Would you recommend us?", "Feedback", "One question, ten seconds.", [f("score", "How likely are you to recommend us?", "select", True, [str(i) for i in range(11)]), f("why", "Why?", "textarea")], "Submit"),
    "service_review": ("Service review", "Feedback", "Tell us about your service today.", [f("staff", "Staff", "rating", True), f("speed", "Speed", "rating"), f("clean", "Cleanliness", "rating"), f("comments", "Comments", "textarea")], "Send review"),
    "contact": ("Contact us", "Contact", "We reply within one working day.", [NAME, EMAIL, f("message", "Message", "textarea", True)], "Send message"),
    "quote": ("Request a quote", "Contact", "Tell us about your project.", [NAME, EMAIL, PHONE, f("budget", "Budget", "select", False, ["< $500", "$500–2 000", "$2 000+"]), f("details", "Project details", "textarea", True)], "Get a quote"),
    "table": ("Table booking", "Bookings", "We’ll confirm by phone.", [NAME, f("phone", "Phone", "phone", True), f("when", "Date & time", "text", True, placeholder="e.g. Fri 7:30 pm"), f("party", "Guests", "select", True, ["1", "2", "3", "4", "5", "6+"])], "Request table"),
    "appointment": ("Appointment request", "Bookings", "Pick a time that suits you.", [NAME, f("phone", "Phone", "phone", True), f("service", "Service", "select", True, ["Consultation", "Treatment", "Follow-up"]), f("when", "Preferred time", "text")], "Request appointment"),
    "newsletter": ("Newsletter sign-up", "Marketing", "News and offers, once a month.", [f("name", "First name", "text"), EMAIL, f("consent", "I agree to receive emails", "checkbox", True)], "Subscribe"),
    "job": ("Job application", "Hiring", "We’re hiring — tell us about you.", [NAME, EMAIL, PHONE, f("role", "Role", "select", True, ["Front of house", "Kitchen", "Management"]), f("about", "About you", "textarea", True)], "Apply"),
    "volunteer": ("Volunteer sign-up", "Community", "Give a few hours, change a lot.", [NAME, EMAIL, f("days", "Availability", "select", True, ["Weekdays", "Weekends", "Either"]), f("skills", "Skills", "textarea")], "Sign up"),
    "catering": ("Catering enquiry", "Bookings", "Events from 10 to 500 guests.", [NAME, EMAIL, PHONE, f("date", "Event date", "text", True), f("guests", "Guests", "text", True), f("notes", "Notes", "textarea")], "Send enquiry"),
    "complaint": ("Report an issue", "Feedback", "Sorry something went wrong — we’ll fix it.", [NAME, EMAIL, f("issue", "What happened?", "textarea", True)], "Send report"),
    "waitlist": ("Join the waitlist", "Marketing", "Be first to know when we open.", [NAME, EMAIL, f("city", "City", "text")], "Join"),
    "survey": ("Customer survey", "Feedback", "Help shape what we do next.", [f("often", "How often do you visit?", "select", True, ["First time", "Monthly", "Weekly", "Daily"]), f("like", "What do you like most?", "textarea"), f("rating", "Overall", "rating")], "Submit"),
}
FORM_DESIGNS = [
    ("form-feedback", "humanist", 18, ["paper", "mint", "peach"]),
    ("form-contact", "sans", 12, ["sky", "white_green", "grey_red"]),
    ("form-booking", "elegant", 16, ["sand", "blush", "forest"]),
    ("form-glass", "display", 16, ["neon_violet", "ink", "teal_gold"]),
    ("form-paper", "serif", 8, ["cream_terracotta", "kraft", "beige_red"]),
    ("form-bold", "condensed", 10, ["white_yellow", "mustard", "ember"]),
    ("form-minimal", "sans", 6, ["lilac", "ocean", "navy_gold"]),
]


def form_template(key, design):
    name, category, desc, fields, submit = FORMS[key]
    layout, dname, pal, font, header, radius = design
    secs = [{"id": "form", "type": "form", "title": name, "description": desc, "fields": fields, "submit_label": submit,
             "success_message": "Thank you — we’ve received it."}, CONTACT]
    return {"id": f"form_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "form", "name": f"{name} · {dname}",
            "description": desc, "category": category, "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


# ── wifi ──────────────────────────────────────────────────────────────────────
WIFI = {
    "cafe": ("Café Wi-Fi", "Enjoy your coffee — laptops welcome until 5 pm."),
    "hotel": ("Hotel Wi-Fi", "Welcome! Connect in your room and all public areas."),
    "restaurant": ("Restaurant Wi-Fi", "Share your meal — tag us!"),
    "office": ("Guest network", "For visitors only. Please don’t use for large downloads."),
    "gym": ("Gym Wi-Fi", "Stream your playlist while you train."),
    "salon": ("Salon Wi-Fi", "Relax and stay connected."),
    "clinic": ("Waiting-room Wi-Fi", "We’ll call your name shortly."),
    "coworking": ("Coworking Wi-Fi", "Fast fibre. Printing at the front desk."),
    "airbnb": ("Holiday rental Wi-Fi", "Welcome home! House guide below."),
    "bar": ("Bar Wi-Fi", "Cheers — ask the bartender for tonight’s specials."),
    "school": ("Visitor Wi-Fi", "Sign in at reception first."),
    "event": ("Event Wi-Fi", "Share with #ourevent."),
    "library": ("Library Wi-Fi", "Quiet zones upstairs."),
    "shop": ("Store Wi-Fi", "Scan products for reviews while you shop."),
}
WIFI_DESIGNS = [
    ("wifi-guest", "sans", 18, ["paper", "mint", "sky"]),
    ("wifi-neon", "display", 18, ["neon_violet", "ink", "lime_night"]),
    ("wifi-paper", "elegant", 10, ["cream_terracotta", "sand", "kraft"]),
    ("wifi-bold", "condensed", 10, ["peach", "mustard", "white_red"]),
    ("wifi-minimal", "sans", 8, ["lilac", "white_green", "grey_red"]),
    ("wifi-frame", "serif", 4, ["black_gold", "teal_gold", "navy_gold"]),
    ("classic", "humanist", 16, ["ocean", "forest", "blush"]),
]


def wifi_template(key, design):
    name, note = WIFI[key]
    layout, dname, pal, font, header, radius = design
    secs = [{"id": "wifi", "type": "wifi", "title": "Free Wi-Fi", "ssid": f"{key.capitalize()}-Guest", "password": "welcome2026",
             "security": "WPA", "hidden": False}, {"id": "note", "type": "text", "markdown": note},
            {"id": "links", "type": "links", "items": [link("Visit our website", "{{business.website}}")]}]
    return {"id": f"wifi_{key}_{layout.replace('-', '_')}_{pal}"[:64], "page_type": "wifi", "name": f"{name} · {dname}",
            "description": note, "category": "Hospitality", "preview_image_url": None,
            "theme": theme(pal, layout, font, header, radius), "sections": secs}


PAL_NAMES = {
    "ember": "Ember", "mustard": "Mustard", "crimson_noir": "Crimson", "chalk": "Chalk", "slate_yellow": "Slate", "teal_gold": "Teal & gold",
    "black_gold": "Black & gold", "navy_gold": "Navy & gold", "mocha": "Mocha", "neon_violet": "Violet night", "lime_night": "Lime night",
    "cream_terracotta": "Terracotta", "kraft": "Kraft", "beige_red": "Brick", "white_green": "Evergreen", "white_red": "Cherry",
    "white_yellow": "Sunshine", "grey_red": "Red & grey", "cream_gingham": "Gingham", "blush": "Blush", "forest": "Forest",
    "ocean": "Ocean", "sky": "Sky", "sand": "Sand", "mint": "Mint", "lilac": "Lilac", "paper": "Paper", "peach": "Peach",
    "rose_night": "Rose night", "ink": "Ink",
}

LAYOUT_NAMES = {
    "catalogue-grid": "Grid", "product-single": "Showcase", "service-list": "Price list", "product-boutique": "Boutique",
    "product-tech": "Tech", "product-bold": "Bold", "service-elegant": "Elegant", "service-studio": "Studio", "menu-grid": "Photo cards",
    "link-hub": "Hub", "link-creator": "Creator", "link-glass": "Glass", "link-paper": "Paper", "link-bold": "Bold",
    "link-minimal": "Minimal", "link-cover": "Cover", "offer-coupon": "Coupon", "offer-flash": "Flash", "offer-poster": "Poster",
    "offer-ticket": "Ticket", "offer-neon": "Neon", "offer-minimal": "Minimal", "offer-kraft": "Kraft flyer", "offer-gingham": "Picnic",
    "event-invite": "Invitation", "event-workshop": "Workshop", "event-gala": "Gala", "event-neon": "Night", "event-poster": "Poster",
    "event-minimal": "Minimal", "event-garden": "Garden", "gallery-portfolio": "Portfolio", "gallery-dark": "Dark room",
    "gallery-frame": "Framed", "gallery-paper": "Scrapbook", "gallery-cover": "Showcase", "classic": "Classic",
    "form-feedback": "Soft", "form-contact": "Clean", "form-booking": "Warm", "form-glass": "Glass", "form-paper": "Paper",
    "form-bold": "Bold", "form-minimal": "Minimal", "wifi-guest": "Guest", "wifi-neon": "Neon", "wifi-paper": "Paper",
    "wifi-bold": "Bold", "wifi-minimal": "Minimal", "wifi-frame": "Framed",
}


NO_EXTRA = {"kraft", "cream_gingham", "chalk", "slate_yellow"}  # textured looks only where chosen on purpose


def looks(specs):
    """Round-robin over layouts, taking each layout's next palette: every look is a distinct layout + colour pair."""
    def more(pals):
        # Hand-picked palettes first, then others with the same light/dark mood.
        dark = P[pals[0]][4]
        return pals + [k for k, v in P.items() if v[4] == dark and k not in pals and k not in NO_EXTRA]
    queues = [[(layout, font, radius, pal) for pal in more(pals)] for layout, font, radius, pals in specs]
    out = []
    while any(queues):
        for q in queues:
            if q:
                out.append(q.pop(0))
    return out


def pairs(keys, specs, per_key):
    """per_key templates per content pack, each with its own look (no two templates share layout + palette)."""
    designs = looks(specs)
    need = len(keys) * per_key
    if need > len(designs):
        raise SystemExit(f"only {len(designs)} looks for {need} templates")
    out = []
    for i, k in enumerate(keys):
        for j in range(per_key):
            # Stride through the looks so one pack's two versions differ in layout and colour.
            layout, font, radius, pal = designs[(i + j * len(keys)) % len(designs)]
            out.append((k, (layout, f"{LAYOUT_NAMES.get(layout, layout)} · {PAL_NAMES[pal]}", pal, font, None, radius)))
    return out


def build() -> list[dict]:
    generated: list[dict] = []
    for layout, dname, pal, font, header, radius, images, packs in MENU_DESIGNS:
        for key in packs:
            generated.append(menu_template(key, layout, dname, pal, font, header, radius, images))
    generated += [product_template(k, d) for k, d in pairs(list(PRODUCTS), PRODUCT_DESIGNS, 2)]
    generated += [links_template(k, d) for k, d in pairs(list(LINKS), LINK_DESIGNS, 2)]
    generated += [offer_template(k, d) for k, d in pairs(list(OFFERS), OFFER_DESIGNS, 2)]
    generated += [event_template(k, d) for k, d in pairs(list(EVENTS), EVENT_DESIGNS, 2)]
    generated += [gallery_template(k, d) for k, d in pairs(list(GALLERIES), GALLERY_DESIGNS, 2)]
    generated += [form_template(k, d) for k, d in pairs(list(FORMS), FORM_DESIGNS, 3)]
    generated += [wifi_template(k, d) for k, d in pairs(list(WIFI), WIFI_DESIGNS, 3)]
    return generated


def main() -> None:
    from app.services.pages import validate_template_data

    current = json.loads(OUT.read_text(encoding="utf-8"))
    core = [t for t in current["templates"] if t["id"] in CORE_IDS]
    templates = core + build()
    ids: set[str] = set()
    for t in templates:
        _, errors = validate_template_data(t)
        if errors:
            raise SystemExit(f"{t['id']}: {errors}")
        if t["id"] in ids:
            raise SystemExit(f"duplicate id {t['id']}")
        if len(t["name"]) > 80:
            raise SystemExit(f"{t['id']}: name too long")
        ids.add(t["id"])
    counts: dict[str, int] = {}
    for t in templates:
        counts[t["page_type"]] = counts.get(t["page_type"], 0) + 1
    short = {k: v for k, v in counts.items() if v < MIN_PER_TYPE}
    if short:
        raise SystemExit(f"fewer than {MIN_PER_TYPE} templates: {short}")
    text = json.dumps({"version": 1, "templates": templates}, ensure_ascii=False, indent=1) + "\n"
    OUT.write_text(text, encoding="utf-8")
    WEB.write_text(text, encoding="utf-8")
    print(f"{len(templates)} templates:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
