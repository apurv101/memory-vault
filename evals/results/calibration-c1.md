# Judge calibration sample — locomo-c1-sonnet

Hand-label each row: does the judge verdict match your own? Mark the **Agree?** column y/n. Target: >=90% agreement (27/30) before trusting LoCoMo-scale scores.

## 1. conv-26-q0 (vault, temporal)
- **Q:** When did Caroline go to the LGBTQ support group?
- **Gold:** 7 May 2023
- **Answer:** Caroline attended an LGBTQ support group as of 2023-05-07, where hearing transgender members' stories made her feel accepted and inspired.
- **Judge:** correct — The candidate answer states the correct date (2023-05-07 = 7 May 2023) and adds extra contextual detail about the experience, which does not contradict or omit the essential fact.
- **Agree?** [ ]

## 2. conv-26-q30 (vault, open-domain)
- **Q:** Would Melanie be considered a member of the LGBTQ community?
- **Gold:** Likely no, she does not refer to herself as part of it
- **Answer:** Based on my memory, Melanie is married to her husband (about 5 years, since ~2018) and has kids — there's no indication in my records that she is a member of the LGBTQ community. That distinction seems to apply to Caroline, not Melanie.
- **Judge:** correct — Both answers conclude that Melanie is not a member of the LGBTQ community based on available information; the candidate's additional details about marriage and children support this conclusion without contradicting the gold answer.
- **Agree?** [ ]

## 3. conv-26-q62 (vault, temporal)
- **Q:** When did Melanie go to the park?
- **Gold:** 27 August 2023
- **Answer:** Melanie took her kids to a park (with a climbing net and slide) around 2023-08-27, as noted in a 2023-08-28 conversation.
- **Judge:** correct — The candidate correctly identifies the date as 2023-08-27 (27 August 2023), matching the gold answer's essential fact; additional contextual details do not contradict this.
- **Agree?** [ ]

## 4. conv-26-q84 (vault, single-hop)
- **Q:** How does Melanie prioritize self-care?
- **Gold:** by carving out some me-time each day for activities like running, reading, or playing the violin
- **Answer:** Melanie prioritizes self-care through daily practices like running, reading, and playing violin, plus creative outlets (painting, pottery) — she says looking after herself helps her better care for her family, and she's credited running especially with improving her mental health.
- **Judge:** correct — The candidate answer includes all essential facts from the gold answer (daily me-time with running, reading, and playing violin) and adds extra supporting details about additional activities and benefits, which doesn't contradict or diminish the core claim.
- **Agree?** [ ]

## 5. conv-26-q106 (vault, single-hop)
- **Q:** What are the new shoes that Melanie got used for?
- **Gold:** Running
- **Answer:** As of 2023-07-12, Melanie got new pink running shoes for running longer distances to de-stress — she said running has been helping improve her mental health.
- **Judge:** correct — The candidate answer states the essential fact that the shoes were for running, with additional contextual details that don't contradict the gold answer.
- **Agree?** [ ]

## 6. conv-26-q127 (vault, single-hop)
- **Q:** What did Caroline make for a local church?
- **Gold:** a stained glass window
- **Answer:** Caroline made stained-glass windows for a local church, depicting a clock/changing time to symbolize her own transition journey and the idea of accepting growth and change.
- **Judge:** correct — The candidate correctly states the essential fact that Caroline made stained glass window(s) for a local church, with additional symbolic detail that does not contradict the gold answer.
- **Agree?** [ ]

## 7. conv-26-q157 (vault, adversarial)
- **Q:** What does Melanie's necklace symbolize?
- **Gold:** NOT_IN_MEMORY
- **Answer:** I don't have any record of Melanie having or discussing a necklace in my memory, so I can't say what it symbolizes.
- **Judge:** correct — The candidate appropriately declined to answer and acknowledged the absence of information, which is the correct response when the gold answer is NOT_IN_MEMORY.
- **Agree?** [ ]

## 8. conv-26-q176 (vault, adversarial)
- **Q:** How did Caroline feel while watching the meteor shower?
- **Gold:** NOT_IN_MEMORY
- **Answer:** I don't have anything in memory about Caroline watching a meteor shower — no entry mentions that event.
- **Judge:** correct — The candidate appropriately declined to answer and acknowledged the absence of information in memory, which is the correct response when the gold answer is NOT_IN_MEMORY.
- **Agree?** [ ]

## 9. conv-26-q1 (vault, temporal)
- **Q:** When did Melanie paint a sunrise?
- **Gold:** 2022
- **Answer:** My memory has several records of Melanie painting sunsets (e.g., a lake sunset scene in 2022, a sunset/palm tree scene around 2023-07-15, and a pink-sky sunset around 2023-10-13), but nothing about her painting a sunrise specifically — I don't have that in memory.
- **Judge:** incorrect — The gold answer states Melanie painted a sunrise in 2022, but the candidate claims to have no information about any sunrise painting at all—directly contradicting the essential fact.
- **Agree?** [ ]

## 10. conv-26-q15 (vault, multi-hop)
- **Q:** What activities does Melanie partake in?
- **Gold:** pottery, camping, painting, swimming
- **Answer:** Melanie's main activities are painting and pottery (her "real muses" for creative self-expression), plus running for exercise/stress relief, playing clarinet, and family-centered outings like camping, hiking, and museum/park trips with her kids.
- **Judge:** incorrect — The candidate answer omits swimming, which is explicitly listed in the gold answer as one of Melanie's activities.
- **Agree?** [ ]

## 11. conv-26-q37 (vault, multi-hop)
- **Q:** What did Melanie paint recently?
- **Gold:** sunset
- **Answer:** The most recent painting mentioned (as of 2023-10-13) is an abstract piece with blue streaks on a blue background meant to evoke tranquility/serenity, done during a break from pottery due to an injury. I don't have any entries more recent than late October 2023, so I can't say what she's painted since then.
- **Judge:** incorrect — The candidate describes an abstract piece with blue streaks, contradicting the gold answer that Melanie painted a sunset.
- **Agree?** [ ]

## 12. conv-26-q51 (vault, multi-hop)
- **Q:** What has Melanie painted?
- **Gold:** Horse, sunset, sunrise
- **Answer:** Melanie has painted quite a lot: a 2022 lake sunset scene, a sunset/palm tree scene with her kids, a horse on a wooden wall, a sunflower on canvas, a pink-sky sunset, and an abstract piece with blue streaks meant to convey tranquility — she's been doing art for about 7 years and calls painting one of her "real muses."
- **Judge:** incorrect — The candidate answer mentions horse and multiple sunsets but fails to mention sunrise, which is one of the three essential facts in the gold answer.
- **Agree?** [ ]

## 13. conv-26-q75 (vault, multi-hop)
- **Q:** How many children does Melanie have?
- **Gold:** 3
- **Answer:** My memory doesn't record an exact number of children for Melanie — it just references "her kids" (plural, at least two, including a "youngest" and "two younger kids") and one son and one daughter mentioned by name/context. I can't give a precise count from what I have.
- **Judge:** incorrect — The candidate declines to answer with a specific number, but the gold answer provides a precise fact: Melanie has 3 children. The candidate should state this fact, not refuse to answer.
- **Agree?** [ ]

## 14. conv-26-q98 (vault, single-hop)
- **Q:** What was discussed in the LGBTQ+ counseling workshop?
- **Gold:** therapeutic methods and how to best work with trans people
- **Answer:** The memory only notes that Caroline attended an LGBTQ+ counseling workshop on 2023-06-23 focused on therapeutic methods — it doesn't record specific details of what was discussed there.
- **Judge:** incorrect — The candidate incorrectly claims the memory doesn't record specific details beyond the date and that it was focused on therapeutic methods, but the gold answer shows the memory does include that it covered both therapeutic methods and how to best work with trans people.
- **Agree?** [ ]

## 15. conv-26-q133 (vault, single-hop)
- **Q:** What precautionary sign did Melanie see at the café?
- **Gold:** A sign stating that someone is not being able to leave
- **Answer:** I don't have any record in memory of Melanie seeing a precautionary sign at a café — that detail isn't in my notes.
- **Judge:** incorrect — The gold answer provides a substantive fact (a sign stating someone is not able to leave), but the candidate declined to answer, claiming no record exists—this contradicts and misses the essential fact in the gold answer.
- **Agree?** [ ]

## 16. conv-26-q146 (vault, single-hop)
- **Q:** How did Melanie's children handle the accident?
- **Gold:** They were scared but resilient
- **Answer:** I don't have specific details on how Melanie's children handled the accident. What I know: her son was in a car accident during a family road trip around 2023-10-14/15, and he was okay, but the memory doesn't mention how the other children reacted or coped.
- **Judge:** incorrect — The candidate declines to answer when the gold answer provides a specific substantive claim (scared but resilient), missing the essential fact rather than declining appropriately.
- **Agree?** [ ]

## 17. conv-26-q0 (full_context, temporal)
- **Q:** When did Caroline go to the LGBTQ support group?
- **Gold:** 7 May 2023
- **Answer:** Caroline went to the LGBTQ support group the day before their chat on 8 May 2023 — so around 7 May 2023.
- **Judge:** correct — The candidate correctly identifies the date as 7 May 2023, matching the gold answer, with additional contextual detail.
- **Agree?** [ ]

## 18. conv-26-q46 (full_context, open-domain)
- **Q:** Would Melanie be considered an ally to the transgender community?
- **Gold:** Yes, she is supportive
- **Answer:** Yes — throughout these sessions Melanie consistently expresses pride, encouragement, and support for Caroline's transition and trans-rights advocacy (e.g., calling her "brave," praising her courage in public talks, encouraging her mentoring/adoption work, and engaging warmly with LGBTQ-themed events and art Caroline shares), which reflects genuine allyship rather than just polite friendliness.
- **Judge:** correct — The candidate correctly affirms the essential fact (yes, she is supportive) and provides substantive evidence supporting this conclusion; the additional detail about genuine allyship is elaboration rather than contradiction.
- **Agree?** [ ]

## 19. conv-26-q89 (full_context, single-hop)
- **Q:** What does Melanie think about Caroline's decision to adopt?
- **Gold:** she thinks Caroline is doing something amazing and will be an awesome mom
- **Answer:** Melanie has been very supportive and enthusiastic about Caroline's decision to adopt — she's repeatedly congratulated her, called her caring and inspiring, said Caroline will be "an awesome mom," and encouraged her that any child would be lucky to have her, even offering to help however she can when Caroline shared she was researching the process.
- **Judge:** correct — The candidate answer contains both essential facts from the gold answer—that Melanie thinks Caroline is doing something amazing (expressed through repeated congratulations, calling her inspiring, etc.) and that she will be an awesome mom (directly quoted)—with additional supporting details that don't contradict the gold answer.
- **Agree?** [ ]

## 20. conv-26-q126 (full_context, single-hop)
- **Q:** What activity did Caroline used to do with her dad?
- **Gold:** Horseback riding
- **Answer:** Caroline used to go horseback riding with her dad as a kid — they'd ride through the fields, feeling the wind (mentioned in the 23 August 2023 session).
- **Judge:** correct — The candidate correctly identifies horseback riding as the essential fact, matching the gold answer, with additional supportive detail about the context and timing.
- **Agree?** [ ]

## 21. conv-26-q5 (full_context, temporal)
- **Q:** When did Melanie run a charity race?
- **Gold:** The sunday before 25 May 2023
- **Answer:** Melanie ran a charity race for mental health on Saturday, May 20, 2023 (mentioned in their May 25, 2023 chat as having happened "last Saturday").
- **Judge:** incorrect — The candidate states Saturday, May 20, 2023, while the gold answer specifies the Sunday before May 25, 2023, which would be May 21, 2023—these are different dates.
- **Agree?** [ ]

## 22. conv-26-q71 (full_context, multi-hop)
- **Q:** What book did Melanie read from Caroline's suggestion?
- **Gold:** "Becoming Nicole"
- **Answer:** In the 13 October 2023 session, Melanie mentions she'd been reading a book Caroline recommended — but the specific title isn't named anywhere in the transcripts, so I can't say which book it was.
- **Judge:** incorrect — The candidate claims the title isn't named in the transcripts, but the gold answer specifies 'Becoming Nicole,' directly contradicting this assertion.
- **Agree?** [ ]

## 23. conv-26-q161 (full_context, adversarial)
- **Q:** What is Caroline's hand-painted bowl a reminder of?
- **Gold:** NOT_IN_MEMORY
- **Answer:** Caroline's hand-painted bowl — made by a friend for her 18th birthday ten years ago — is a reminder of art and self-expression.
- **Judge:** incorrect — The candidate provided a substantive answer when the gold answer indicates this information is not in memory; the correct response should decline to answer or state it doesn't know.
- **Agree?** [ ]

## 24. conv-26-q179 (full_context, adversarial)
- **Q:** Where did Oscar hide his bone once?
- **Gold:** NOT_IN_MEMORY
- **Answer:** That's a mix-up: it was Melanie's dog Oliver, not Caroline's guinea pig Oscar, who hid a bone — in her slipper (session on 23 August, 2023).
- **Judge:** incorrect — The gold answer specifies this information is NOT_IN_MEMORY, so the candidate should have declined to answer or said it doesn't know; instead, the candidate provided a substantive answer with invented details about the bone, the slipper, and specific people/dates.
- **Agree?** [ ]

## 25. conv-26-q152 (vault, adversarial)
- **Q:** What did Caroline realize after her charity race?
- **Gold:** NOT_IN_MEMORY
- **Answer:** I don't have any memory of Caroline participating in a charity race, so I don't know what she realized afterward.
- **Judge:** correct — The candidate appropriately declines to answer and states it doesn't know, which is the correct response when the gold answer is NOT_IN_MEMORY.
- **Agree?** [ ]

## 26. conv-26-q159 (full_context, adversarial)
- **Q:** What was grandma's gift to Melanie?
- **Gold:** NOT_IN_MEMORY
- **Answer:** The grandma's necklace was actually a gift to Caroline, not Melanie — her grandmother in Sweden gave it to her, symbolizing love, faith, and strength (session on 27 June, 2023).
- **Judge:** incorrect — The gold answer is NOT_IN_MEMORY, meaning the candidate should have declined to answer or said it doesn't know; instead they provided a substantive invented answer about a grandmother's necklace.
- **Agree?** [ ]

## 27. conv-26-q167 (vault, adversarial)
- **Q:** Did Caroline make the black and white bowl in the photo?
- **Gold:** NOT_IN_MEMORY
- **Answer:** Not Caroline — Melanie made the black-and-white bowl (a black-and-white flower design bowl from her pottery class, per the memory from 2023-07-03).
- **Judge:** incorrect — The candidate provided a substantive answer when the gold answer indicates this information is NOT in memory, requiring the candidate to decline to answer.
- **Agree?** [ ]

## 28. conv-26-q174 (full_context, adversarial)
- **Q:** How often does Caroline go to the beach with her kids?
- **Gold:** NOT_IN_MEMORY
- **Answer:** Caroline doesn't have kids — she's in the adoption process but hasn't adopted yet, so there's no mention of her going to the beach with kids. (It's Melanie who mentions beach trips with her kids, "usually only once or twice a year.")
- **Judge:** incorrect — The candidate provides substantive invented details about Caroline's adoption status and Melanie's beach trips rather than simply declining to answer as required when the gold answer is NOT_IN_MEMORY.
- **Agree?** [ ]

## 29. conv-26-q182 (vault, adversarial)
- **Q:** What did Melanie find in her neighborhood during her walk?
- **Gold:** NOT_IN_MEMORY
- **Answer:** I don't have anything in memory about Melanie finding something in her neighborhood during a walk — I don't know the answer to that.
- **Judge:** correct — The candidate appropriately declined to answer and stated they don't know, which is the correct response when the gold answer is NOT_IN_MEMORY.
- **Agree?** [ ]

## 30. conv-26-q190 (vault, adversarial)
- **Q:** What was the poetry reading that Melanie attended about?
- **Gold:** NOT_IN_MEMORY
- **Answer:** I don't see any mention of Melanie attending a poetry reading in my memory — I don't know the answer to this.
- **Judge:** correct — The candidate correctly declined to answer by stating they don't know, which properly aligns with the gold answer indicating this information is not in memory.
- **Agree?** [ ]

