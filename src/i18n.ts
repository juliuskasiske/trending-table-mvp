/**
 * Tiny i18n engine for the onboarding flow — English + German, no framework.
 *
 * - Static markup carries `data-i18n` (textContent), `data-i18n-html` (innerHTML,
 *   for copy with inline markup) or `data-i18n-ph` (input placeholder) keys.
 * - Dynamic controller strings go through `t(key, vars)` with `{var}` slots.
 * - The chosen language persists in localStorage and drives `<html lang>`.
 */

export type Lang = "en" | "de";

type Dict = Record<string, string>;

const STORAGE_KEY = "tt-lang";

const en: Dict = {
  "meta.title": "Get started — Trending Table",
  "topbar.tag": "Restaurant sign-up",

  // Entry chooser
  "gate.eyebrow": "Welcome to Trending Table",
  "gate.title": "Log in or sign up",
  "gate.sub": "Pick your side of the marketplace.",
  "gate.signup": "Sign up",
  "gate.login": "Log in",
  "gate.email": "Email",
  "gate.password": "Password",
  "gate.loginFailed": "Invalid email or password.",
  "gate.loggingIn": "Logging in…",
  "gate.registered": "Account created — log in to continue.",
  "gate.accountDeleted": "This account was deleted.",
  "gate.noAccount": "No account yet? Register below:",
  "gate.restaurant.title": "Restaurant",
  "gate.restaurant.desc": "Book local creators and fill your tables.",
  "gate.creator.title": "Creator",
  "gate.creator.desc": "Get paid to post about places you love.",
  "gate.soon.creator": "The creator side is coming soon — we'll open it up shortly.",
  "gate.soon.restaurantLogin": "Restaurant login is coming soon. For now, use Sign up to get started.",
  "progress.step": "Step",
  "progress.of": "of",

  "btn.back": "Back",
  "btn.continue": "Continue",
  "btn.review": "Review",
  "btn.edit": "Edit",
  "btn.search": "Search",
  "btn.digitize": "Digitize",
  "btn.createAccount": "Create account",
  "btn.saveCard": "Save card",
  "btn.subscribe": "Confirm & subscribe",

  // Step 1 — account
  "account.eyebrow": "Register as a restaurant",
  "account.title": "Create your account",
  "account.sub":
    "Skip the ad budget. Book local creators and fill your tables. This is the only thing you'll type by hand — the rest we pull in for you.",
  "account.email.label": "Work email",
  "account.email.ph": "owner@yourrestaurant.com",
  "account.email.err": "Enter a valid email address.",
  "account.password.label": 'Password <span class="hint">(min. 8 characters)</span>',
  "account.password.err": "Use at least 8 characters.",

  // Step 2 — restaurant
  "restaurant.eyebrow": "One search, everything filled",
  "restaurant.title": "Find your restaurant",
  "restaurant.sub":
    "Search Google and we'll pull in your name, logo, address, rating, category and description automatically. You just confirm.",
  "restaurant.search.label": "Restaurant name & city",
  "restaurant.search.ph": "e.g. Osteria Nova, Berlin",
  "restaurant.search.hint": "Enter your name and city, then hit Search.",
  "restaurant.place.err": "Please pick your restaurant to continue.",
  "restaurant.manualToggle": "Can't find it? Enter details manually",
  "restaurant.prefill.pulled": "Pulled from Google. Edit anything that's off.",
  "restaurant.prefill.manual": "Enter your details — you can refine them anytime.",
  "restaurant.searchAgain": "Search again",
  "restaurant.name.label": "Name",
  "restaurant.category.label": 'Category <span class="hint">(Kategorisierung)</span>',
  "restaurant.website.label": "Website",
  "restaurant.address.label": "Address",
  "restaurant.description.label": 'Short description <span class="hint">(Kurzbeschreibung)</span>',
  "restaurant.description.ph": "One or two lines about your place.",

  "menu.label": "Menu",
  "menu.tab.link": "Link",
  "menu.tab.pdf": "Upload PDF",
  "menu.link.ph": "https://…/menu",
  "menu.link.hint": "Paste your menu page and we'll pull the items from it.",
  "menu.drop.text": "Drop a PDF menu here, or click to choose",
  "menu.add": "+ Add item",
  "menu.improve": "✨ Improve with AI",

  // Step 3 — billing
  "billing.eyebrow": "Stay in control",
  "billing.title": "Set your monthly budget",
  "billing.sub":
    "You pay €0.01 per view plus a {fee} platform fee. Spend stops the moment you hit your limit — never a euro more.",
  "billing.fig.limit": "Monthly limit",
  "billing.fig.views": "Est. views / month",
  "billing.fig.reach": "Est. reach value",
  "billing.breakdown.a": "At your limit:",
  "billing.breakdown.b": "platform fee +",
  "billing.breakdown.c": "in views",
  "billing.breakdown.d": "views at €0.01 each).",
  "pay.title": "Payment method",
  "pay.err": "Please add a payment method to continue.",
  "pay.statusText": "Subscription active",
  "billing.cadence.label": "Billing cycle",
  "billing.cadence.monthly": "Monthly",
  "billing.cadence.annual": "Annual",
  "billing.cadence.monthlyNote": "{fee}/month platform fee. Per-view spend is always billed as used.",
  "billing.cadence.annualNote":
    "Platform fee billed yearly: {discounted}/year instead of {full} — you save {savings} (20%). Per-view spend stays pay-as-you-go.",

  // Step 4 — guidelines
  "guidelines.eyebrow": "Set the creative brief",
  "guidelines.title": "Your content guidelines",
  "guidelines.sub":
    "Tell creators what good looks like. We've pre-picked sensible defaults — adjust, then add anything specific at the bottom.",
  "guidelines.handle.label": 'Handle to tag <span class="hint">(optional)</span>',
  "guidelines.handle.ph": "@yourrestaurant",
  "guidelines.group.show": "Posts should show",
  "guidelines.group.must": "Every post must",
  "guidelines.group.avoid": "Please avoid",
  "guidelines.notes.label": 'Anything else? <span class="hint">(free text)</span>',
  "guidelines.notes.ph":
    "e.g. Our terrace looks best in daylight. Please feature the wood-fired oven.",

  // Step 5 — review
  "review.eyebrow": "Almost there",
  "review.title": "Review and confirm",
  "review.sub": "Check the details, then create your restaurant account.",
  "review.group.account": "Account",
  "review.group.restaurant": "Restaurant",
  "review.group.billing": "Budget & payment",
  "review.group.guidelines": "Content guidelines",
  "review.email": "Email",
  "review.name": "Name",
  "review.category": "Category",
  "review.address": "Address",
  "review.rating": "Google rating",
  "review.menu": "Menu",
  "review.limit": "Monthly limit",
  "review.views": "Est. views",
  "review.billing": "Billing cycle",
  "review.payment": "Payment",
  "review.cycle.monthly": "Monthly — {fee}/month",
  "review.cycle.annual": "Annual — {discounted}/year (20% off)",
  "review.show": "Show",
  "review.must": "Must include",
  "review.avoid": "Avoid",
  "review.consent":
    'I agree to the <a href="#" tabindex="-1">Terms</a> and <a href="#" tabindex="-1">Privacy Policy</a>, and to a {fee} monthly platform fee plus €0.01 per view while my account is active.',
  "review.consent.err": "Please accept the terms to continue.",

  // Success
  "done.title": "You're in.",
  "done.p1": "Your restaurant account for ",
  "done.p2":
    " is ready. We're matching verified local creators to your guidelines — your first picks land in that inbox.",
  "done.email.default": "your inbox",
  "done.restart": "Start another restaurant",

  // Step names (progress label)
  "stepname.account": "Create account",
  "stepname.restaurant": "Find your restaurant",
  "stepname.billing": "Budget & payment",
  "stepname.guidelines": "Content guidelines",
  "stepname.review": "Review & confirm",
  "stepname.done": "Done",

  // Dynamic — search
  "search.searching": "Searching…",
  "search.noMatches":
    "No matches for “{q}”. Check the spelling, or enter details manually.",
  "search.placesOff":
    "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). You can enter details manually.",
  "search.placesOffBelow":
    "Live Google search isn't configured (add GOOGLE_MAPS_API_KEY). Enter your details manually below.",
  "search.serverDown":
    "Can't reach the server. Start the backend (uvicorn on :8000) and reload — or enter details manually.",
  "search.typePrompt": "Type your restaurant name and city, then hit Search.",
  "search.sessionLost": "Please sign in again to continue — your session wasn't active.",
  "search.unreachable":
    "Couldn't reach search — make sure the backend is running (uvicorn on :8000). You can enter details manually.",
  "result.loading": "Loading…",

  // Dynamic — profile / stars / menu
  "stars.none": "No Google rating yet",
  "stars.reviews": "{n} reviews",
  "place.defaultCategory": "Restaurant",
  "menu.section.ph": "Section",
  "menu.item.ph": "Item name",
  "menu.item.fallback": "item",
  "menu.remove": "Remove {name}",
  "menu.readOne": "Read 1 item. Edit below, or improve with AI.",
  "menu.readMany": "Read {n} items. Edit below, or improve with AI.",
  "menu.noItemsPdf": "No items found — try improving with AI, or a clearer PDF.",
  "menu.noItemsLink": "No items found — try improving with AI, or the PDF upload.",
  "menu.choosePdf": "Please choose a PDF file.",
  "menu.readingFile": "Reading “{name}”…",
  "menu.improving": "Improving with AI… this can take a few seconds.",
  "menu.improved": "Improved — {n} items.",
  "menu.aiFailed": "AI cleanup failed: {err}",
  "menu.addUrlFirst": "Add your menu page URL first.",
  "menu.reading": "Reading your menu page…",
  "menu.readErr": "Couldn't read this menu: {err}",
  "menu.readErr2": "Couldn't read that menu: {err}",

  // Dynamic — payment
  "pay.noCard":
    "No card needed to sign up — we'll ask for a payment method before your first campaign goes live.",
  "pay.finishRestaurant": "Finish the restaurant step first.",
  "pay.stripeLoadFail": "Stripe.js failed to load",
  "pay.stripeStartErr": "Couldn't start Stripe: {err}",
  "pay.saving": "Saving…",
  "pay.subscribing": "Confirming…",
  "pay.subFail": "Payment could not be confirmed.",
  "pay.subscribed": "Subscription active",
  "pay.startsOn": "No charge today — your first payment is on {date}.",
  "pay.promoPlaceholder": "Discount code",
  "pay.promoApply": "Apply",
  "pay.promoChecking": "Checking…",
  "pay.promoInvalid": "That code is invalid or expired.",
  "pay.promoApplied": "Code {code} applied — you pay {first} first, then {regular}.",
  "price.perMonth": "/mo",
  "price.annualCaption": "billed yearly ({yearly}/yr)",
  "price.firstMonthCaption": "first month — then {regular}/mo",
  "pay.cardNotSaved": "Card could not be saved.",
  "pay.saved": "Payment method saved",
  "pay.savedCard": "{brand} •••• {last4} saved",

  // Dynamic — review values
  "review.menuItems": "{n} menu items",
  "review.addedLater": "Added later",
  "review.limitMonth": "{v} / month",
  "review.viewsMonth": "~{v} / month",
  "review.cardSaved": "Card saved",
  "review.notAdded": "Not added",
  "review.addedBeforeLaunch": "Added before launch",
  "review.none": "None",

  // Dynamic — submit / done / config
  "submit.creating": "Creating account…",
  "done.titleName": "You're in, {name}.",
  "config.menuNeedsMarkItDown":
    "Menu digitization needs the MarkItDown library on the server (pip install 'markitdown[pdf]').",
  "config.menuAddLlm":
    "Add LLM_BASE_URL + LLM_API_KEY (gpt-oss-120b) for best results. Without them, items are extracted with a simpler parser.",
  "error.generic": "Something went wrong. Please try again.",
  "verify.ok": "Email confirmed — you're all set.",
  "verify.fail": "That verification link is invalid or has expired.",
  "verify.sent": "We sent a confirmation link to {email}. Check your inbox to verify your account.",

  // Guideline chip labels (also used as stable stored values)
  "chip.Signature dishes": "Signature dishes",
  "chip.Interior & atmosphere": "Interior & atmosphere",
  "chip.Drinks & cocktails": "Drinks & cocktails",
  "chip.Team & chef": "Team & chef",
  "chip.Plating close-ups": "Plating close-ups",
  "chip.Exterior / storefront": "Exterior / storefront",
  "chip.Tag our handle": "Tag our handle",
  "chip.Add the location tag": "Add the location tag",
  "chip.Show at least one dish": "Show at least one dish",
  "chip.Other guests' faces": "Other guests' faces",
  "chip.Heavy alcohol focus": "Heavy alcohol focus",
  "chip.Competitor mentions": "Competitor mentions",
  "chip.Off-brand filters": "Off-brand filters",

  // Account management area
  "account.pageTitle": "Your account — Trending Table",
  "account.nav.tag": "Account",
  "account.nav.restaurants": "Restaurants",
  "account.nav.account": "Account & security",
  "account.nav.dashboard": "Dashboard",
  "account.nav.creators": "Find creators",
  "account.nav.bookings": "Bookings",
  "account.nav.messages": "Messages",
  "account.nav.settings": "Settings",
  "account.settings.restaurants": "Restaurants",
  "account.settings.account": "Account",
  "account.language": "Language",
  "account.comingSoon": "Coming soon",
  "account.comingSoonSub": "We're putting the finishing touches on it — almost ready.",
  "account.signout": "Log out",
  "bookings.sub": "Your creator collaborations and the content they've published.",
  "bookings.noRestaurant": "Add a restaurant first to start booking creators.",
  "bookings.empty": "No bookings yet. Invite a creator to get started.",
  "bookings.creatorFallback": "Creator",
  "bookings.awaiting": "Awaiting post",
  "bookings.viewContent": "View content ({n})",
  "bookings.col.creator": "Creator",
  "bookings.col.deliverable": "Deliverable",
  "bookings.col.date": "Date",
  "bookings.col.status": "Status",
  "bookings.col.content": "Content",
  "bookings.status.proposed": "Pending",
  "bookings.status.accepted": "Confirmed",
  "bookings.status.live": "Live",
  "bookings.status.completed": "Completed",
  "bookings.status.cancelled": "Cancelled",
  "content.back": "Back to bookings",
  "content.published": "Published content",
  "content.noPosts": "The creator hasn't published anything for this booking yet.",
  "content.views": "Views",
  "content.likes": "Likes",
  "content.watchOn": "Watch on {platform}",
  "creators.search": "Search name or handle",
  "creators.all": "All",
  "creators.empty": "No creators match your search yet.",
  "creators.noRating": "No ratings yet",
  "creators.reviewCount": "{n} rating(s)",
  "creators.reviews": "Reviews",
  "creators.specialties": "Specialties",
  "creators.channels": "Channels",
  "creators.invite": "Invite",
  "creators.invited": "Invited",
  "creators.rate": "Rate this creator",
  "creators.yourRating": "Your rating",
  "creators.commentPlaceholder": "Add a comment (optional)",
  "creators.submitReview": "Submit rating",
  "creators.updateReview": "Update rating",
  "creators.pickStars": "Pick a star rating first.",
  "account.rest.title": "Your restaurants",
  "account.rest.add": "Add a restaurant",
  "account.rest.empty": "No restaurants yet.",
  "account.rstatus.provisioning": "Setting up",
  "account.rstatus.active": "Active",
  "account.rstatus.suspended": "Suspended",
  "account.rstatus.deleted": "Deleted",
  "account.plan.none": "No plan",
  "account.plan.trialing": "Trial",
  "account.plan.active": "Active",
  "account.plan.past_due": "Past due",
  "account.plan.canceled": "Canceled",
  "account.plan.incomplete": "Incomplete",
  "account.plan.unpaid": "Unpaid",
  "account.tab.profile": "Profile",
  "account.tab.menu": "Menu",
  "account.tab.guidelines": "Guidelines",
  "account.tab.billing": "Billing",
  "account.save": "Save",
  "account.saved": "Saved",
  "account.profile.name": "Name",
  "account.profile.address": "Address",
  "account.profile.city": "City",
  "account.profile.category": "Category",
  "account.profile.tags": "Tags (comma-separated)",
  "account.profile.description": "Description",
  "account.profile.website": "Website",
  "account.profile.logo": "Logo URL",
  "account.profile.price": "Price level",
  "account.menu.section": "Section",
  "account.menu.name": "Item",
  "account.menu.price": "Price",
  "account.menu.add": "Add item",
  "account.menu.remove": "Remove",
  "account.menu.empty": "No menu items yet.",
  "account.menu.redigitizeUrl": "Re-scan from a menu link",
  "account.menu.urlPlaceholder": "https://…",
  "account.menu.scan": "Scan",
  "account.menu.scanning": "Scanning…",
  "account.menu.scanFail": "Couldn't read that link.",
  "account.g.hint": "Separate multiple entries with commas.",
  "account.g.show": "Show in posts",
  "account.g.must": "Must include",
  "account.g.avoid": "Avoid",
  "account.g.handle": "Handle to tag",
  "account.g.notes": "Notes",
  "account.billing.status": "Status",
  "account.billing.cadence": "Billing cycle",
  "account.billing.cadence.monthly": "Monthly",
  "account.billing.cadence.annual": "Annual",
  "account.billing.nextPayment": "Next payment",
  "account.billing.trialUntil": "Free until",
  "account.billing.limit": "Monthly spending limit (€)",
  "account.billing.limitHint": "Includes the platform fee.",
  "account.billing.cancelPlan": "Cancel plan",
  "account.billing.cancelNote": "Your plan ends on {date}. No further charges.",
  "account.billing.cancelConfirmTitle": "Cancel plan",
  "account.billing.cancelConfirm": "Billing stops at the end of the current period. You keep access until then.",
  "account.acct.displayName": "Display name",
  "account.acct.email": "Email",
  "account.acct.status": "Verification",
  "account.acct.verified": "Verified",
  "account.acct.unverified": "Not verified",
  "account.acct.resend": "Resend verification email",
  "account.acct.resent": "Sent",
  "account.acct.password": "Change password",
  "account.acct.currentPw": "Current password",
  "account.acct.newPw": "New password",
  "account.acct.changePw": "Update password",
  "account.acct.pwChanged": "Password updated",
  "account.danger.title": "Danger zone",
  "account.danger.deleteRestaurant": "Delete this restaurant",
  "account.danger.deleteRestaurantHint": "Stops its billing and removes it from your account. The data is retained but deactivated.",
  "account.danger.deleteRestaurantConfirm": "Type the restaurant name ({name}) to confirm.",
  "account.danger.deleteAccount": "Delete account",
  "account.danger.deleteAccountHint": "Cancels every subscription (platform fee and usage) and revokes access. Your data is retained but deactivated.",
  "account.danger.deleteAccountConfirm": "Type your email ({email}) to confirm.",
  "account.confirm.cancel": "Keep it",
  "account.confirm.confirm": "Confirm",
  "account.confirm.working": "Working…",
  "account.error.load": "Couldn't load this. Try again.",
  "account.error.save": "Couldn't save. Try again.",

  // Creator registration
  "creator.pageTitle": "Become a creator — Trending Table",
  "creator.eyebrow": "Join as a creator",
  "creator.error": "Something went wrong. Try again.",
  "creator.signup.title": "Create your creator account",
  "creator.signup.sub": "Get matched with local restaurants and earn per view.",
  "creator.signup.cta": "Create account",
  "creator.signup.working": "Creating…",
  "creator.handles.title": "Your channels",
  "creator.handles.sub": "Add at least one — Instagram, TikTok or YouTube. You can connect the others later.",
  "creator.handles.cta": "Continue",
  "creator.handles.working": "Saving…",
  "creator.handles.needOne": "Enter at least one handle.",
  "creator.connect.title": "Connect Instagram",
  "creator.connect.sub": "Connect Instagram so we can read your stats automatically. TikTok and YouTube stay as handles for now.",
  "creator.connect.ig": "Connect Instagram",
  "creator.connect.opening": "Opening Instagram…",
  "creator.connect.finish": "Finish",
  "creator.connect.none": "No channels yet.",
  "creator.connect.connected": "{handle} · {followers} followers",
  "creator.connect.notConnected": "Not connected yet",
  "creator.connect.saved": "{handle} · saved",
  "creator.connect.pillOn": "connected",
  "creator.connect.pillOff": "handle",
  "creator.connect.justConnected": "Instagram connected — your stats are now linked.",
  "creator.connect.failed": "Instagram couldn't be connected. Please try again.",
  "creator.done.title": "You're all set.",
  "creator.done.sub": "We'll match you with restaurants that fit your content. Watch your inbox.",
};

const de: Dict = {
  "meta.title": "Loslegen — Trending Table",
  "topbar.tag": "Restaurant-Anmeldung",

  "gate.eyebrow": "Willkommen bei Trending Table",
  "gate.title": "Anmelden oder registrieren",
  "gate.sub": "Wähle deine Seite des Marktplatzes.",
  "gate.signup": "Registrieren",
  "gate.login": "Anmelden",
  "gate.email": "E-Mail",
  "gate.password": "Passwort",
  "gate.loginFailed": "Ungültige E-Mail oder Passwort.",
  "gate.loggingIn": "Anmeldung läuft…",
  "gate.registered": "Konto erstellt — melde dich an, um fortzufahren.",
  "gate.accountDeleted": "Dieses Konto wurde gelöscht.",
  "gate.noAccount": "Noch kein Konto? Registriere dich unten:",
  "gate.restaurant.title": "Restaurant",
  "gate.restaurant.desc": "Buche lokale Creator und füll deine Tische.",
  "gate.creator.title": "Creator",
  "gate.creator.desc": "Verdiene Geld, indem du über Orte postest, die du liebst.",
  "gate.soon.creator": "Die Creator-Seite kommt bald — wir schalten sie in Kürze frei.",
  "gate.soon.restaurantLogin": "Der Restaurant-Login kommt bald. Nutze vorerst „Registrieren“, um zu starten.",
  "progress.step": "Schritt",
  "progress.of": "von",

  "btn.back": "Zurück",
  "btn.continue": "Weiter",
  "btn.review": "Überprüfen",
  "btn.edit": "Ändern",
  "btn.search": "Suchen",
  "btn.digitize": "Digitalisieren",
  "btn.createAccount": "Konto erstellen",
  "btn.saveCard": "Karte speichern",
  "btn.subscribe": "Bestätigen & abonnieren",

  "account.eyebrow": "Als Restaurant registrieren",
  "account.title": "Konto erstellen",
  "account.sub":
    "Spar dir das Werbebudget. Buche lokale Creator und füll deine Tische. Das ist das Einzige, was du selbst eintippst — den Rest holen wir für dich.",
  "account.email.label": "Geschäftliche E-Mail",
  "account.email.ph": "inhaber@deinrestaurant.de",
  "account.email.err": "Bitte gib eine gültige E-Mail-Adresse ein.",
  "account.password.label": 'Passwort <span class="hint">(mind. 8 Zeichen)</span>',
  "account.password.err": "Verwende mindestens 8 Zeichen.",

  "restaurant.eyebrow": "Eine Suche, alles ausgefüllt",
  "restaurant.title": "Finde dein Restaurant",
  "restaurant.sub":
    "Such bei Google und wir übernehmen Name, Logo, Adresse, Bewertung, Kategorie und Beschreibung automatisch. Du bestätigst nur.",
  "restaurant.search.label": "Restaurantname & Stadt",
  "restaurant.search.ph": "z. B. Osteria Nova, Berlin",
  "restaurant.search.hint": "Gib Name und Stadt ein und klick auf Suchen.",
  "restaurant.place.err": "Bitte wähle dein Restaurant aus, um fortzufahren.",
  "restaurant.manualToggle": "Nicht gefunden? Details manuell eingeben",
  "restaurant.prefill.pulled": "Von Google übernommen. Ändere alles, was nicht stimmt.",
  "restaurant.prefill.manual": "Gib deine Details ein — du kannst sie jederzeit anpassen.",
  "restaurant.searchAgain": "Erneut suchen",
  "restaurant.name.label": "Name",
  "restaurant.category.label": 'Kategorie <span class="hint">(Kategorisierung)</span>',
  "restaurant.website.label": "Website",
  "restaurant.address.label": "Adresse",
  "restaurant.description.label": 'Kurzbeschreibung <span class="hint">(Kurzbeschreibung)</span>',
  "restaurant.description.ph": "Ein oder zwei Zeilen über dein Lokal.",

  "menu.label": "Speisekarte",
  "menu.tab.link": "Link",
  "menu.tab.pdf": "PDF hochladen",
  "menu.link.ph": "https://…/speisekarte",
  "menu.link.hint": "Füg deine Speisekarten-Seite ein und wir lesen die Gerichte aus.",
  "menu.drop.text": "PDF-Speisekarte hierher ziehen oder zum Auswählen klicken",
  "menu.add": "+ Gericht hinzufügen",
  "menu.improve": "✨ Mit KI verbessern",

  "billing.eyebrow": "Behalte die Kontrolle",
  "billing.title": "Leg dein Monatsbudget fest",
  "billing.sub":
    "Du zahlst 0,01 € pro View plus {fee} Plattformgebühr. Die Ausgaben stoppen, sobald du dein Limit erreichst — keinen Euro mehr.",
  "billing.fig.limit": "Monatslimit",
  "billing.fig.views": "Geschätzte Views / Monat",
  "billing.fig.reach": "Geschätzter Reichweitenwert",
  "billing.breakdown.a": "An deinem Limit:",
  "billing.breakdown.b": "Plattformgebühr +",
  "billing.breakdown.c": "an Views",
  "billing.breakdown.d": "Views zu je 0,01 €).",
  "pay.title": "Zahlungsmethode",
  "pay.err": "Bitte füge eine Zahlungsmethode hinzu, um fortzufahren.",
  "pay.statusText": "Abo aktiv",
  "billing.cadence.label": "Abrechnungszeitraum",
  "billing.cadence.monthly": "Monatlich",
  "billing.cadence.annual": "Jährlich",
  "billing.cadence.monthlyNote": "{fee}/Monat Plattformgebühr. Views werden immer nach Verbrauch abgerechnet.",
  "billing.cadence.annualNote":
    "Plattformgebühr jährlich abgerechnet: {discounted}/Jahr statt {full} — du sparst {savings} (20 %). Views bleiben nutzungsbasiert.",

  "guidelines.eyebrow": "Leg das Kreativ-Briefing fest",
  "guidelines.title": "Deine Content-Richtlinien",
  "guidelines.sub":
    "Sag Creatorn, wie gute Inhalte aussehen. Wir haben sinnvolle Voreinstellungen gewählt — passe sie an und ergänze unten alles Spezifische.",
  "guidelines.handle.label": 'Handle zum Markieren <span class="hint">(optional)</span>',
  "guidelines.handle.ph": "@deinrestaurant",
  "guidelines.group.show": "Posts sollten zeigen",
  "guidelines.group.must": "Jeder Post muss",
  "guidelines.group.avoid": "Bitte vermeiden",
  "guidelines.notes.label": 'Sonst noch etwas? <span class="hint">(Freitext)</span>',
  "guidelines.notes.ph":
    "z. B. Unsere Terrasse wirkt bei Tageslicht am besten. Bitte zeigt den Holzofen.",

  "review.eyebrow": "Fast geschafft",
  "review.title": "Prüfen und bestätigen",
  "review.sub": "Prüf die Angaben und erstell dann dein Restaurant-Konto.",
  "review.group.account": "Konto",
  "review.group.restaurant": "Restaurant",
  "review.group.billing": "Budget & Zahlung",
  "review.group.guidelines": "Content-Richtlinien",
  "review.email": "E-Mail",
  "review.name": "Name",
  "review.category": "Kategorie",
  "review.address": "Adresse",
  "review.rating": "Google-Bewertung",
  "review.menu": "Speisekarte",
  "review.limit": "Monatslimit",
  "review.views": "Geschätzte Views",
  "review.billing": "Abrechnungszeitraum",
  "review.payment": "Zahlung",
  "review.cycle.monthly": "Monatlich — {fee}/Monat",
  "review.cycle.annual": "Jährlich — {discounted}/Jahr (20 % Rabatt)",
  "review.show": "Zeigen",
  "review.must": "Muss enthalten",
  "review.avoid": "Vermeiden",
  "review.consent":
    'Ich stimme den <a href="#" tabindex="-1">AGB</a> und der <a href="#" tabindex="-1">Datenschutzerklärung</a> zu sowie einer monatlichen Plattformgebühr von {fee} plus 0,01 € pro View, solange mein Konto aktiv ist.',
  "review.consent.err": "Bitte akzeptiere die Bedingungen, um fortzufahren.",

  "done.title": "Du bist dabei.",
  "done.p1": "Dein Restaurant-Konto für ",
  "done.p2":
    " ist bereit. Wir matchen verifizierte lokale Creator mit deinen Richtlinien — deine ersten Vorschläge landen in diesem Postfach.",
  "done.email.default": "dein Postfach",
  "done.restart": "Weiteres Restaurant hinzufügen",

  "stepname.account": "Konto erstellen",
  "stepname.restaurant": "Restaurant finden",
  "stepname.billing": "Budget & Zahlung",
  "stepname.guidelines": "Content-Richtlinien",
  "stepname.review": "Prüfen & bestätigen",
  "stepname.done": "Fertig",

  "search.searching": "Suche läuft…",
  "search.noMatches":
    "Keine Treffer für „{q}“. Prüf die Schreibweise oder gib die Details manuell ein.",
  "search.placesOff":
    "Die Live-Google-Suche ist nicht konfiguriert (GOOGLE_MAPS_API_KEY hinzufügen). Du kannst die Details manuell eingeben.",
  "search.placesOffBelow":
    "Die Live-Google-Suche ist nicht konfiguriert (GOOGLE_MAPS_API_KEY hinzufügen). Gib deine Details unten manuell ein.",
  "search.serverDown":
    "Server nicht erreichbar. Starte das Backend (uvicorn auf :8000) und lade neu — oder gib die Details manuell ein.",
  "search.typePrompt": "Gib Restaurantname und Stadt ein und klick auf Suchen.",
  "search.sessionLost": "Bitte melde dich erneut an — deine Sitzung war nicht aktiv.",
  "search.unreachable":
    "Suche nicht erreichbar — stell sicher, dass das Backend läuft (uvicorn auf :8000). Du kannst die Details manuell eingeben.",
  "result.loading": "Lädt…",

  "stars.none": "Noch keine Google-Bewertung",
  "stars.reviews": "{n} Bewertungen",
  "place.defaultCategory": "Restaurant",
  "menu.section.ph": "Kategorie",
  "menu.item.ph": "Gericht",
  "menu.item.fallback": "Gericht",
  "menu.remove": "{name} entfernen",
  "menu.readOne": "1 Gericht gelesen. Bearbeite unten oder verbessere mit KI.",
  "menu.readMany": "{n} Gerichte gelesen. Bearbeite unten oder verbessere mit KI.",
  "menu.noItemsPdf": "Keine Gerichte gefunden — probier „Mit KI verbessern“ oder ein klareres PDF.",
  "menu.noItemsLink": "Keine Gerichte gefunden — probier „Mit KI verbessern“ oder den PDF-Upload.",
  "menu.choosePdf": "Bitte wähle eine PDF-Datei.",
  "menu.readingFile": "„{name}“ wird gelesen…",
  "menu.improving": "Verbesserung mit KI… das kann ein paar Sekunden dauern.",
  "menu.improved": "Verbessert — {n} Gerichte.",
  "menu.aiFailed": "KI-Bereinigung fehlgeschlagen: {err}",
  "menu.addUrlFirst": "Füg zuerst die URL deiner Speisekarten-Seite hinzu.",
  "menu.reading": "Speisekarte wird gelesen…",
  "menu.readErr": "Speisekarte konnte nicht gelesen werden: {err}",
  "menu.readErr2": "Speisekarte konnte nicht gelesen werden: {err}",

  "pay.noCard":
    "Zum Anmelden ist keine Karte nötig — wir fragen nach einer Zahlungsmethode, bevor deine erste Kampagne live geht.",
  "pay.finishRestaurant": "Schließ zuerst den Restaurant-Schritt ab.",
  "pay.stripeLoadFail": "Stripe.js konnte nicht geladen werden",
  "pay.stripeStartErr": "Stripe konnte nicht gestartet werden: {err}",
  "pay.saving": "Speichern…",
  "pay.subscribing": "Wird bestätigt…",
  "pay.subFail": "Zahlung konnte nicht bestätigt werden.",
  "pay.subscribed": "Abo aktiv",
  "pay.startsOn": "Heute keine Zahlung — deine erste Zahlung erfolgt am {date}.",
  "pay.promoPlaceholder": "Rabattcode",
  "pay.promoApply": "Einlösen",
  "pay.promoChecking": "Wird geprüft…",
  "pay.promoInvalid": "Dieser Code ist ungültig oder abgelaufen.",
  "pay.promoApplied": "Code {code} aktiv — du zahlst zuerst {first}, danach {regular}.",
  "price.perMonth": "/Monat",
  "price.annualCaption": "jährlich abgerechnet ({yearly}/Jahr)",
  "price.firstMonthCaption": "erster Monat — danach {regular}/Monat",
  "pay.cardNotSaved": "Karte konnte nicht gespeichert werden.",
  "pay.saved": "Zahlungsmethode gespeichert",
  "pay.savedCard": "{brand} •••• {last4} gespeichert",

  "review.menuItems": "{n} Gerichte",
  "review.addedLater": "Später hinzugefügt",
  "review.limitMonth": "{v} / Monat",
  "review.viewsMonth": "~{v} / Monat",
  "review.cardSaved": "Karte gespeichert",
  "review.notAdded": "Nicht hinzugefügt",
  "review.addedBeforeLaunch": "Vor dem Start hinzugefügt",
  "review.none": "Keine",

  "submit.creating": "Konto wird erstellt…",
  "done.titleName": "Du bist dabei, {name}.",
  "config.menuNeedsMarkItDown":
    "Die Speisekarten-Digitalisierung benötigt die MarkItDown-Bibliothek auf dem Server (pip install 'markitdown[pdf]').",
  "config.menuAddLlm":
    "Füg LLM_BASE_URL + LLM_API_KEY (gpt-oss-120b) für beste Ergebnisse hinzu. Ohne sie werden Gerichte mit einem einfacheren Parser extrahiert.",
  "error.generic": "Etwas ist schiefgelaufen. Bitte versuch es erneut.",
  "verify.ok": "E-Mail bestätigt — alles erledigt.",
  "verify.fail": "Dieser Bestätigungslink ist ungültig oder abgelaufen.",
  "verify.sent": "Wir haben einen Bestätigungslink an {email} gesendet. Prüf dein Postfach, um dein Konto zu bestätigen.",

  "chip.Signature dishes": "Signature-Gerichte",
  "chip.Interior & atmosphere": "Interieur & Atmosphäre",
  "chip.Drinks & cocktails": "Drinks & Cocktails",
  "chip.Team & chef": "Team & Küchenchef",
  "chip.Plating close-ups": "Anrichte-Nahaufnahmen",
  "chip.Exterior / storefront": "Außenansicht / Fassade",
  "chip.Tag our handle": "Unseren Handle markieren",
  "chip.Add the location tag": "Standort-Tag hinzufügen",
  "chip.Show at least one dish": "Mindestens ein Gericht zeigen",
  "chip.Other guests' faces": "Gesichter anderer Gäste",
  "chip.Heavy alcohol focus": "Starker Alkoholfokus",
  "chip.Competitor mentions": "Erwähnung von Wettbewerbern",
  "chip.Off-brand filters": "Markenfremde Filter",

  // Account management area
  "account.pageTitle": "Dein Konto — Trending Table",
  "account.nav.tag": "Konto",
  "account.nav.restaurants": "Restaurants",
  "account.nav.account": "Konto & Sicherheit",
  "account.nav.dashboard": "Dashboard",
  "account.nav.creators": "Creator finden",
  "account.nav.bookings": "Buchungen",
  "account.nav.messages": "Nachrichten",
  "account.nav.settings": "Einstellungen",
  "account.settings.restaurants": "Restaurants",
  "account.settings.account": "Konto",
  "account.language": "Sprache",
  "account.comingSoon": "Bald verfügbar",
  "account.comingSoonSub": "Wir feilen noch an den letzten Details — fast fertig.",
  "account.signout": "Abmelden",
  "bookings.sub": "Deine Creator-Kooperationen und die veröffentlichten Inhalte.",
  "bookings.noRestaurant": "Füge zuerst ein Restaurant hinzu, um Creator zu buchen.",
  "bookings.empty": "Noch keine Buchungen. Lade einen Creator ein, um zu starten.",
  "bookings.creatorFallback": "Creator",
  "bookings.awaiting": "Wartet auf Post",
  "bookings.viewContent": "Inhalt ansehen ({n})",
  "bookings.col.creator": "Creator",
  "bookings.col.deliverable": "Leistung",
  "bookings.col.date": "Datum",
  "bookings.col.status": "Status",
  "bookings.col.content": "Inhalt",
  "bookings.status.proposed": "Ausstehend",
  "bookings.status.accepted": "Bestätigt",
  "bookings.status.live": "Live",
  "bookings.status.completed": "Abgeschlossen",
  "bookings.status.cancelled": "Storniert",
  "content.back": "Zurück zu Buchungen",
  "content.published": "Veröffentlichte Inhalte",
  "content.noPosts": "Der Creator hat für diese Buchung noch nichts veröffentlicht.",
  "content.views": "Aufrufe",
  "content.likes": "Likes",
  "content.watchOn": "Auf {platform} ansehen",
  "creators.search": "Name oder Handle suchen",
  "creators.all": "Alle",
  "creators.empty": "Noch keine Creator für deine Suche gefunden.",
  "creators.noRating": "Noch keine Bewertungen",
  "creators.reviewCount": "{n} Bewertung(en)",
  "creators.reviews": "Bewertungen",
  "creators.specialties": "Schwerpunkte",
  "creators.channels": "Kanäle",
  "creators.invite": "Einladen",
  "creators.invited": "Eingeladen",
  "creators.rate": "Creator bewerten",
  "creators.yourRating": "Deine Bewertung",
  "creators.commentPlaceholder": "Kommentar hinzufügen (optional)",
  "creators.submitReview": "Bewertung abgeben",
  "creators.updateReview": "Bewertung aktualisieren",
  "creators.pickStars": "Bitte zuerst Sterne auswählen.",
  "account.rest.title": "Deine Restaurants",
  "account.rest.add": "Restaurant hinzufügen",
  "account.rest.empty": "Noch keine Restaurants.",
  "account.rstatus.provisioning": "Wird eingerichtet",
  "account.rstatus.active": "Aktiv",
  "account.rstatus.suspended": "Pausiert",
  "account.rstatus.deleted": "Gelöscht",
  "account.plan.none": "Kein Abo",
  "account.plan.trialing": "Testphase",
  "account.plan.active": "Aktiv",
  "account.plan.past_due": "Überfällig",
  "account.plan.canceled": "Gekündigt",
  "account.plan.incomplete": "Unvollständig",
  "account.plan.unpaid": "Unbezahlt",
  "account.tab.profile": "Profil",
  "account.tab.menu": "Speisekarte",
  "account.tab.guidelines": "Richtlinien",
  "account.tab.billing": "Abrechnung",
  "account.save": "Speichern",
  "account.saved": "Gespeichert",
  "account.profile.name": "Name",
  "account.profile.address": "Adresse",
  "account.profile.city": "Stadt",
  "account.profile.category": "Kategorie",
  "account.profile.tags": "Tags (kommagetrennt)",
  "account.profile.description": "Beschreibung",
  "account.profile.website": "Website",
  "account.profile.logo": "Logo-URL",
  "account.profile.price": "Preisniveau",
  "account.menu.section": "Bereich",
  "account.menu.name": "Gericht",
  "account.menu.price": "Preis",
  "account.menu.add": "Gericht hinzufügen",
  "account.menu.remove": "Entfernen",
  "account.menu.empty": "Noch keine Gerichte.",
  "account.menu.redigitizeUrl": "Neu einlesen von einem Speisekarten-Link",
  "account.menu.urlPlaceholder": "https://…",
  "account.menu.scan": "Einlesen",
  "account.menu.scanning": "Wird eingelesen…",
  "account.menu.scanFail": "Dieser Link konnte nicht gelesen werden.",
  "account.g.hint": "Mehrere Einträge mit Kommas trennen.",
  "account.g.show": "In Posts zeigen",
  "account.g.must": "Muss enthalten",
  "account.g.avoid": "Vermeiden",
  "account.g.handle": "Zu markierender Handle",
  "account.g.notes": "Notizen",
  "account.billing.status": "Status",
  "account.billing.cadence": "Abrechnungszyklus",
  "account.billing.cadence.monthly": "Monatlich",
  "account.billing.cadence.annual": "Jährlich",
  "account.billing.nextPayment": "Nächste Zahlung",
  "account.billing.trialUntil": "Kostenlos bis",
  "account.billing.limit": "Monatliches Ausgabenlimit (€)",
  "account.billing.limitHint": "Enthält die Plattformgebühr.",
  "account.billing.cancelPlan": "Abo kündigen",
  "account.billing.cancelNote": "Dein Abo endet am {date}. Keine weiteren Abbuchungen.",
  "account.billing.cancelConfirmTitle": "Abo kündigen",
  "account.billing.cancelConfirm": "Die Abrechnung endet zum Ende der aktuellen Periode. Bis dahin bleibt der Zugang bestehen.",
  "account.acct.displayName": "Anzeigename",
  "account.acct.email": "E-Mail",
  "account.acct.status": "Verifizierung",
  "account.acct.verified": "Verifiziert",
  "account.acct.unverified": "Nicht verifiziert",
  "account.acct.resend": "Bestätigungs-E-Mail erneut senden",
  "account.acct.resent": "Gesendet",
  "account.acct.password": "Passwort ändern",
  "account.acct.currentPw": "Aktuelles Passwort",
  "account.acct.newPw": "Neues Passwort",
  "account.acct.changePw": "Passwort aktualisieren",
  "account.acct.pwChanged": "Passwort aktualisiert",
  "account.danger.title": "Gefahrenzone",
  "account.danger.deleteRestaurant": "Dieses Restaurant löschen",
  "account.danger.deleteRestaurantHint": "Beendet die Abrechnung und entfernt es aus deinem Konto. Die Daten bleiben erhalten, aber deaktiviert.",
  "account.danger.deleteRestaurantConfirm": "Gib den Restaurantnamen ({name}) ein, um zu bestätigen.",
  "account.danger.deleteAccount": "Konto löschen",
  "account.danger.deleteAccountHint": "Kündigt alle Abos (Plattformgebühr und Nutzung) und entzieht den Zugang. Deine Daten bleiben erhalten, aber deaktiviert.",
  "account.danger.deleteAccountConfirm": "Gib deine E-Mail ({email}) ein, um zu bestätigen.",
  "account.confirm.cancel": "Behalten",
  "account.confirm.confirm": "Bestätigen",
  "account.confirm.working": "Wird ausgeführt…",
  "account.error.load": "Konnte nicht geladen werden. Bitte erneut versuchen.",
  "account.error.save": "Konnte nicht gespeichert werden. Bitte erneut versuchen.",

  // Creator registration
  "creator.pageTitle": "Creator werden — Trending Table",
  "creator.eyebrow": "Als Creator mitmachen",
  "creator.error": "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  "creator.signup.title": "Erstelle dein Creator-Konto",
  "creator.signup.sub": "Werde mit lokalen Restaurants gematcht und verdiene pro View.",
  "creator.signup.cta": "Konto erstellen",
  "creator.signup.working": "Wird erstellt…",
  "creator.handles.title": "Deine Kanäle",
  "creator.handles.sub": "Gib mindestens einen an — Instagram, TikTok oder YouTube. Die anderen kannst du später verbinden.",
  "creator.handles.cta": "Weiter",
  "creator.handles.working": "Wird gespeichert…",
  "creator.handles.needOne": "Gib mindestens einen Handle ein.",
  "creator.connect.title": "Instagram verbinden",
  "creator.connect.sub": "Verbinde Instagram, damit wir deine Statistiken automatisch lesen können. TikTok und YouTube bleiben vorerst nur als Handle.",
  "creator.connect.ig": "Instagram verbinden",
  "creator.connect.opening": "Instagram wird geöffnet…",
  "creator.connect.finish": "Fertig",
  "creator.connect.none": "Noch keine Kanäle.",
  "creator.connect.connected": "{handle} · {followers} Follower",
  "creator.connect.notConnected": "Noch nicht verbunden",
  "creator.connect.saved": "{handle} · gespeichert",
  "creator.connect.pillOn": "verbunden",
  "creator.connect.pillOff": "Handle",
  "creator.connect.justConnected": "Instagram verbunden — deine Statistiken sind jetzt verknüpft.",
  "creator.connect.failed": "Instagram konnte nicht verbunden werden. Bitte erneut versuchen.",
  "creator.done.title": "Alles bereit.",
  "creator.done.sub": "Wir matchen dich mit passenden Restaurants. Behalte dein Postfach im Auge.",
};

const messages: Record<Lang, Dict> = { en, de };

const listeners = new Set<() => void>();

function detectInitial(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "de") return saved;
  } catch {
    /* ignore */
  }
  // German is the default; a saved choice above always wins.
  return "de";
}

let current: Lang = detectInitial();

export function getLang(): Lang {
  return current;
}

/** Translate a key, interpolating `{var}` slots. Falls back to English, then the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = messages[current][key] ?? messages.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Display label for a guideline chip (stored value stays English). */
export function tChip(englishLabel: string): string {
  return t(`chip.${englishLabel}`);
}

/** Translate all annotated static markup under `root`. */
export function applyStatic(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach((el) => {
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPh!);
  });
  document.title = t("meta.title");
}

export function onLangChange(cb: () => void): void {
  listeners.add(cb);
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  applyStatic();
  listeners.forEach((cb) => cb());
}

/** Set `<html lang>`, translate the static page, and wire the EN/DE toggle. */
export function initI18n(): void {
  document.documentElement.lang = current;
  applyStatic();
  const toggle = document.getElementById("lang-toggle");
  if (!toggle) return;
  const sync = () => {
    toggle.querySelectorAll<HTMLButtonElement>("button[data-lang]").forEach((b) => {
      const on = b.dataset.lang === current;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };
  toggle.querySelectorAll<HTMLButtonElement>("button[data-lang]").forEach((b) => {
    b.addEventListener("click", () => setLang(b.dataset.lang as Lang));
  });
  onLangChange(sync);
  sync();
}
