/* Review Finder — topic finder.
 * Reads a review's text and finds the topics it talks about (food, staff, cleanliness...), in English
 * and Arabic, by keywords. Each topic is counted once per review, however many times it comes up,
 * and gets a direction: praise or complaint. Works sentence by sentence, so
 * "food was great but the service was slow" gives Food 👍 and Service 👎.
 * Pure front-end, no AI and no cost. Topic keys match the quick-pick issue keys in store.js.
 */
const RFTopics = (() => {
  // Arabic: drop diacritics and tatweel, unify letter forms, so "الأكل" and "الاكل" match.
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[’`]/g, "'");

  // English entries match the start of a word ("tast" finds taste, tasty, tasteless).
  // Arabic entries match anywhere in a word, so prefixes like ال / و / بال still match.
  const T = {
    food: {
      en: ['food', 'meal', 'dish', 'tast', 'delicious', 'flavo', 'burger', 'pizza', 'rice$', 'chicken', 'meat', 'steak', 'fish', 'seafood', 'shrimp', 'coffee', 'tea$', 'karak', 'dessert', 'cake', 'bread', 'salad', 'portion', 'menu', 'fries', 'sauce', 'breakfast', 'lunch', 'dinner', 'overcooked', 'undercooked', 'bland', 'salty', 'spicy', 'fresh', 'juice', 'drink', 'sandwich', 'shawarma', 'kabsa', 'mandi'],
      ar: ['اكل', 'طعم', 'لذيذ', 'وجبه', 'طبق', 'برجر', 'بيتزا', 'رز$', 'دجاج', 'لحم', 'سمك', 'روبيان', 'قهوه', 'شاي', 'كرك', 'حلى', 'حلا', 'كيك', 'خبز', 'سلطه', 'بطاطس', 'صوص', 'فطور', 'غدا$', 'عشا$', 'مالح', 'محروق', 'طازج', 'عصير', 'مشروب', 'ساندويش', 'شاورما', 'كبسه', 'مندي', 'منيو'],
    },
    service: {
      en: ['service', 'slow', 'fast', 'quick', 'wait', 'took', 'minute', 'delay', 'late', 'served', 'order'],
      ar: ['خدمه', 'بطي', 'سريع', 'انتظار', 'انتظرنا', 'انتظرت', 'تاخر', 'تاخير', 'دقيقه', 'دقايق', 'الطلب', 'طلبنا'],
    },
    staff: {
      en: ['staff', 'waiter', 'waitress', 'server', 'team', 'employee', 'receptionist', 'manager', 'cashier', 'rude', 'friendly', 'polite', 'attitude', 'helpful', 'nurse', 'barber', 'stylist', 'host$', 'guy$', 'lady$', 'people', 'welcom', 'impolite', 'ignored', 'smil'],
      ar: ['موظف', 'العامل', 'العمال', 'ويتر', 'جرسون', 'الاستقبال', 'المدير', 'كاشير', 'تعامل', 'اسلوب', 'محترم', 'وقح', 'لطيف', 'ممرض', 'حلاق', 'الشباب', 'البنات', 'ترحيب', 'خدوم', 'قليل ادب', 'ابتسام'],
    },
    clean: {
      en: ['clean', 'dirty', 'hygien', 'toilet', 'bathroom', 'washroom', 'restroom', 'smell', 'dust', 'mess', 'spotless', 'filthy', 'insect', 'cockroach', 'stain', 'tidy', 'untidy', 'sticky'],
      ar: ['نظيف', 'نظاف', 'وسخ', 'قذر', 'حمام', 'دوره المياه', 'ريحه', 'رايحه', 'غبار', 'حشرات', 'صرصور', 'بقع', 'مرتب'],
    },
    value: {
      en: ['price', 'expensive', 'cheap', 'overpriced', 'value', 'worth', 'cost', 'pricey', 'affordable', 'money', 'reasonable', 'sar$', 'riyal'],
      ar: ['سعر', 'اسعار', 'غالي', 'رخيص', 'يستاهل', 'قيمه', 'فلوس', 'مبلغ', 'ريال', 'معقول'],
    },
    room: {
      en: ['room', 'bed', 'pillow', 'air condition', 'aircon', 'a/c', 'view', 'towel', 'shower', 'noise', 'noisy', 'wifi', 'wi-fi', 'sheet', 'suite', 'balcony'],
      ar: ['غرفه', 'الغرف', 'سرير', 'مخده', 'مكيف', 'تكييف', 'اطلاله', 'فوط', 'دش$', 'ازعاج', 'واي فاي', 'شراشف', 'جناح', 'بلكونه'],
    },
    checkin: {
      en: ['check-in', 'check in', 'checkin', 'check-out', 'check out', 'checkout', 'front desk', 'key card', 'keycard', 'reservation', 'arrival'],
      ar: ['تسجيل الدخول', 'تسجيل دخول', 'تسجيل الخروج', 'تسجيل خروج', 'تشيك', 'الحجز', 'المفتاح', 'كرت الغرفه', 'الوصول'],
    },
    wait: {
      en: ['wait', 'queue', 'line$', 'hour', 'minute', 'late', 'delay', 'long time', 'forever', 'on time', 'quick', 'fast'],
      ar: ['انتظار', 'انتظرت', 'انتظرنا', 'طابور', 'ساعه', 'دقيقه', 'دقايق', 'تاخر', 'تاخير', 'بسرعه', 'سريع', 'موعدي'],
    },
    doctor: {
      en: ['doctor', 'dr$', 'dentist', 'physician', 'consultant', 'specialist', 'diagnos', 'explain', 'treatment', 'examin', 'rushed', 'surgeon'],
      ar: ['دكتور', 'الطبيب', 'طبيب', 'دكتوره', 'تشخيص', 'شرح', 'علاج', 'كشف', 'استشاري', 'اخصائي', 'جراح'],
    },
    billing: {
      en: ['bill$', 'bills$', 'billing', 'invoice', 'insurance', 'charged', 'charge', 'payment', 'pay$', 'paid', 'claim', 'approval', 'refund'],
      ar: ['فاتوره', 'تامين', 'دفع', 'حساب', 'موافقه', 'مطالبه', 'استرجاع', 'مبلغ'],
    },
    booking: {
      en: ['appointment', 'booking', 'book$', 'booked', 'reschedul', 'cancel', 'schedule', 'slot'],
      ar: ['موعد', 'مواعيد', 'حجز', 'تاجيل', 'الغاء', 'الغو'],
    },
    result: {
      en: ['haircut', 'cut$', 'colour', 'color', 'nail', 'result', 'style', 'beard', 'facial', 'massage', 'makeup', 'make-up', 'hair', 'wax', 'manicure', 'pedicure'],
      ar: ['قصه', 'صبغه', 'اظافر', 'نتيجه', 'لحيه', 'تسريحه', 'مساج', 'مكياج', 'ميك اب', 'شعر', 'شمع', 'منكير', 'بديكير'],
    },
    stock: {
      en: ['stock', 'availab', 'sold out', 'item', 'product', 'size', 'range', 'selection', 'shelf', 'shelves'],
      ar: ['متوفر', 'المنتج', 'منتجات', 'مقاس', 'نفذ', 'نفد', 'خلص', 'تشكيله', 'الرفوف'],
    },
  };

  // Words that say good or bad. Negators flip a good word that follows them ("not good").
  const POS = {
    en: ['great', 'good', 'excellent', 'amazing', 'delicious', 'tasty', 'friendly', 'fast', 'quick', 'clean', 'perfect', 'love', 'nice', 'best', 'wonderful', 'fantastic', 'helpful', 'professional', 'polite', 'fresh', 'reasonable', 'affordable', 'worth', 'recommend', 'kind', 'spotless', 'comfortable', 'awesome', 'super', 'lovely', 'happy', 'thank', 'impressive', 'smooth', 'on time', 'welcom', 'tidy', 'cheap', 'beautiful'],
    ar: ['ممتاز', 'رائع', 'لذيذ', 'حلو', 'نظيف', 'سريع', 'لطيف', 'محترم', 'خدوم', 'روعه', 'جميل', 'افضل', 'يجنن', 'تحفه', 'يستاهل', 'معقول', 'مناسب', 'احترافي', 'شكرا', 'طازج', 'مريح', 'مرتب', 'بسرعه', 'انصح', 'رهيب', 'كويس', 'زين', 'طيب', 'رخيص', 'مبدع'],
  };
  const NEG = {
    en: ['bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'cold', 'rude', 'dirty', 'slow', 'late', 'expensive', 'overpriced', 'disappoint', 'bland', 'salty', 'burnt', 'overcooked', 'undercooked', 'raw$', 'unprofessional', 'ignored', 'mess', 'smell', 'broken', 'noisy', 'problem', 'issue', 'complain', 'never again', 'long', 'wrong', 'forgot', 'missing', 'stale', 'filthy', 'unclean', 'pricey', 'waste', 'hate', 'annoy', 'impolite', 'delay', 'rushed', 'uncomfortable', 'sticky', 'untidy', 'sold out', 'out of stock', 'not available', 'unavailable', 'cancel', 'rejected', 'forever'],
    ar: ['سيء', 'سيي', 'زفت', 'وسخ', 'قذر', 'بارد', 'بطي', 'متاخر', 'تاخر', 'تاخير', 'غالي', 'مشكله', 'ردي', 'خايس', 'معفن', 'مالح', 'محروق', 'وقح', 'قليل ادب', 'زحمه', 'خربان', 'خراب', 'طويل', 'ما له طعم', 'ماله طعم', 'غلط', 'نسوا', 'ناقص', 'مزعج', 'ازعاج', 'تجاهل', 'مو نظيف', 'غير نظيف', 'سرقه', 'نصب', 'غير متوفر', 'مو متوفر', 'نفذ', 'نفد', 'الغاء', 'رفض', 'تعبان'],
  };
  // Whole words only: "no" must not match "now", "لا" must not match "الاكل"
  const NEGATORS = { en: ['not$', 'no$', 'never$', "isn't$", "wasn't$", "weren't$", "don't$", "didn't$", "doesn't$", 'without$', 'hardly$', "aren't$", "won't$", "couldn't$"], ar: ['مو$', 'مب$', 'مش$', 'ليس$', 'غير$', 'ما$', 'لا$', 'ولا$', 'وما$', 'بدون$', 'مافي$', 'ماكان$'] };

  const isArabicWord = (w) => /[؀-ۿ]/.test(w);
  // Does keyword `k` occur in this clause? English: at a word start. Arabic: anywhere inside.
  // A trailing $ means the whole word only ("tea$" finds tea, not team; "لا$" not inside "الاكل").
  const cache = new Map();
  function find(clause, k) {
    let re = cache.get(k);
    if (!re) {
      const whole = k.endsWith('$'), w = whole ? k.slice(0, -1) : k;
      const ar = isArabicWord(w), letters = ar ? '\\u0600-\\u06FF' : "a-z'";
      const body = w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      re = ar && !whole ? new RegExp(`()${body}`)
        : new RegExp(`(^|[^${letters}])${body}${whole ? `(?![${letters}])` : ''}`);
      cache.set(k, re);
    }
    const m = re.exec(clause);
    return m ? m.index + m[1].length : -1;
  }
  function hits(clause, list) {
    const out = [];
    for (const k of list.en.concat(list.ar)) { const i = find(clause, k); if (i >= 0) out.push({ k, i }); }
    return out;
  }
  // Positive minus negative words in a clause, with "not good" counted as negative.
  function score(clause) {
    let s = 0;
    const negs = hits(clause, NEGATORS).map((h) => h.i);
    for (const h of hits(clause, POS)) {
      const flipped = negs.some((n) => n < h.i && h.i - n <= 14);
      s += flipped ? -1 : 1;
    }
    for (const h of hits(clause, NEG)) {
      // "no problem", "not slow", "ما في مشكله" read as fine
      const flipped = negs.some((n) => n < h.i && h.i - n <= 10);
      s += flipped ? 0.5 : -1;
    }
    return s;
  }

  // Split on sentence ends and "but"-style turns, so each part carries one opinion.
  const SPLIT = /[.!?؟,،;:\n]+|\s(?:but|however|although|though|except|while)\s|\sلكن\s|\sبس\s|\s(?=وال)|\sالا\s|\sمع ان\s/;

  /**
   * analyze(text, topicKeys, rating) → [{ k, pol: 'pos' | 'neg' | 'neu', words: [...] }]
   * topicKeys: the topics that make sense for this type of business (RC.issuesFor(b)).
   */
  function analyze(text, topicKeys, rating) {
    const clauses = norm(text).split(SPLIT).map((c) => ` ${c.trim()} `).filter((c) => c.trim().length > 1);
    const found = new Map();
    for (const c of clauses) {
      const s = score(c);
      for (const key of topicKeys) {
        const words = T[key] ? hits(c, T[key]).map((h) => h.k) : [];
        if (!words.length) continue;
        const cur = found.get(key) || { k: key, s: 0, n: 0, words: new Set() };
        cur.s += s; cur.n++; words.forEach((w) => cur.words.add(w.replace(/\$$/, '').trim()));
        found.set(key, cur);
      }
    }
    // No clear opinion in the sentence: fall back on the star rating.
    const fallback = rating >= 4 ? 'pos' : rating && rating <= 2 ? 'neg' : 'neu';
    return [...found.values()]
      .map((t) => ({ k: t.k, pol: t.s > 0 ? 'pos' : t.s < 0 ? 'neg' : fallback, words: [...t.words] }))
      .sort((a, b) => (a.pol === b.pol ? 0 : a.pol === 'neg' ? -1 : b.pol === 'neg' ? 1 : 0));
  }

  /**
   * forReview(text, picked, topicKeys, rating): the topics in the written text, plus the issues the
   * customer tapped on the review page (always complaints). Still one entry per topic.
   */
  function forReview(text, picked, topicKeys, rating) {
    const keys = [...new Set([...topicKeys, ...(picked || [])])];
    const out = text ? analyze(text, keys, rating) : [];
    for (const k of picked || []) {
      const t = out.find((x) => x.k === k);
      if (t) { t.pol = 'neg'; t.picked = true; } else out.push({ k, pol: 'neg', words: [], picked: true });
    }
    return out.sort((a, b) => (a.pol === b.pol ? 0 : a.pol === 'neg' ? -1 : b.pol === 'neg' ? 1 : 0));
  }

  return { analyze, forReview, norm, KEYS: Object.keys(T) };
})();
if (typeof module !== 'undefined') module.exports = RFTopics;
