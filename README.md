# intruth

hi everyone!

https://chromewebstore.google.com/detail/InTruth/ikmpglbpcdoapfelcbfpoaddmhmaaocg?hl=en&authuser=0

built a real-time factchecker called intruth for live debates, speeches, interviews, press conferences, and political events!


<img width="400" height="225" alt="image" src="https://github.com/user-attachments/assets/a0a8fba9-c28f-473c-866d-84951a9b548e" />

it listens to audio from the active browser tab, identifies factual claims as they are made, and provides instant evidence-based verdicts using AI analysis and web research; most fact-checking docs come out days after debates, but now users can evaluate claims as they're made.

this is part of a bigger research project @ my university so more to come!

## features

- live claim detection: continuously monitors speech from the active tab and identifies check-worthy factual claims in real time

- live claim evaluation: analyzes claim veracity using large language models and external sources to determine whether a statement is:

* TRUE
* SUBSTANTIALLY TRUE
* FALSE
* MISLEADING
* UNVERIFIABLE

- speaker attribution: tracks speakers throughout a discussion and attributes claims to the correct participant whenever possible

- context analysis: uses surrounding conversation and event context to improve claim identification and reduce false positives

- real-time verdicts: veracity checks and sources appear while the debate or interview is still in progress

- bring-your-own-key: users provide their own anthropic API key

## how to use intruth:

1. open a video, livestream, debate, interview, or speech.
2. start the extension, and assign speakers w/ the press of a button
3. audio from the active tab is captured
4. speech transcribed 
5. check-worthy, factual claims are extracted
6. claims evaluated against authoritative sources
7. verdicts, explanations are displayed to the user!!!

## what's check-worthy?? 

check-worthy claims in this context are:

* specific factual statements
* statistics and numerical claims
* historical events
* government actions and policies
* scientific and medical claims
* public records and documented events

i.e. 
* "inflation peaked at 9.1% in 2022."
* "the bill passed the Senate in 2021."
* "the unemployment rate is currently below 5%."

NOT:
* opinions
* predictions / future promises
* rhetorical questions
* value judgments
* subjective descriptions

i.e.
* "This policy will destroy the economy."
* "I have the best plan."
* "If my opponent wins, disaster will follow."

## privacy details

users provide their own API credentials, i have no access to that

transcript data may be sent directly to the AI service configured by the user in order to generate fact-check results

see privacy policy on web store for complete details!

## permissions

tabcapture: extracts audio from the active browser tab after the user explicitly starts a fact-checking session.

activetab: allows the extension to interact with the currently selected tab

scripting: injects the fact-checking interface into supported pages.

storage: stores user preferences and API configuration LOCALLY

offscreen: supports background audio processing and transcription workflows.

## limitations and warnings

fact-checking is inherently imperfect! generated verdicts may occasionally be incorrect, incomplete, or based on outdated information. if you're unsure about something, independently evaluate it and consult original sources when making decisions!

this extension is as an informational tool and NOT a definitive authority !

### requirements

* Chrome Manifest V3
* User-provided AI API key
* Modern Chromium-based browser

## contributing

would love advice, any features you'd like, and any edge cases you've found! 
## license

view license tab
