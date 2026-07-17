/* Texts for the "Мистер Лапкинс принёс подарок!" gift-box flow — the modal that opens the
   treasure box, plus the five "he brought nothing" fail-scene stories (~40% chance, see
   BOX_FAIL_CHANCE in index.html). Edit freely — index.html just reads these by key through
   its own t() translation lookup, same as everything in the main translations object.

   ru/en must stay in sync: every key that exists in one must exist in the other. */

var GIFT_BOX_TEXTS = {
  ru: {
    box_title: "Мистер Лапкинс принёс подарок!",
    box_hint: "Нажми на коробку",
    btn_yay: "Ура!",
    reward_title_maxed: "Коллекция прокачана!",
    reward_description_maxed: "Мистер Лапкинс гордится тобой — все сокровища этой коллекции собраны и прокачаны до предела.",
    reward_title_new: "Новый предмет!",
    reward_title_levelup: "Уровень повышен!",

    fail_1_title: "Кошачья жопка",
    fail_1_text: "Я застрял в заборе по дороге и ничего не принёс... Помоги вылезти!",
    fail_2_title: "Тыгыдык",
    fail_2_text: "Я так радовался твоим задачам, что увлёкся тыгыдыком и выронил подарок. Но побегал на славу!",
    fail_3_title: "Сон в луче",
    fail_3_text: "Я шёл за наградой, но нашёл тёплый лучик солнца на полу. Короче, я спать, сокровища подождут...",
    fail_4_title: "Охотник",
    fail_4_text: "Никаких алмазов не нашёл, но смотри, какую классную шуршащую бумажку я тебе поймал! От сердца отрываю.",
    fail_5_title: "Коробка",
    fail_5_text: "Я принёс тебе подарок, но коробка от него оказалась такой удобной, что я сел в неё, а подарок где-то выбросил..."
  },
  en: {
    box_title: "Mr. Lapkins brought you a gift!",
    box_hint: "Tap the box",
    btn_yay: "Yay!",
    reward_title_maxed: "Collection maxed out!",
    reward_description_maxed: "Mr. Lapkins is proud of you — every treasure in this collection is gathered and leveled to the max.",
    reward_title_new: "New item!",
    reward_title_levelup: "Level up!",

    fail_1_title: "Stuck Butt",
    fail_1_text: "I got stuck in the fence on the way and brought nothing... Help me out!",
    fail_2_title: "Zoomies",
    fail_2_text: "I got so excited about your tasks that I got carried away with the zoomies and dropped the gift. But I sure ran well!",
    fail_3_title: "Sunbeam Nap",
    fail_3_text: "I was on my way with your reward, but found a warm sunbeam on the floor. Anyway, nap time — the treasure can wait...",
    fail_4_title: "The Hunter",
    fail_4_text: "Didn't find any diamonds, but check out this awesome crinkly wrapper I caught for you! Straight from the heart.",
    fail_5_title: "The Box",
    fail_5_text: "I brought you a gift, but the box it came in was so comfy that I sat in it — and tossed the gift somewhere..."
  }
};
