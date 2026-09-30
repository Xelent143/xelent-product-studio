# Xelent Product Studio

A Claude skill that takes an apparel business from **industry research** to **approved product designs**,
**consistent photorealistic product photographs** and **Etsy / Alibaba.com listings submitted as drafts**.
Built for sportswear, teamwear, streetwear, activewear, combat-sports gear, outerwear and garments in general.

It runs on [Xelent API](https://xelentapi.com) and only on Xelent API: every image and every listing goes through
your Xelent account.

## What it does

1. **Learns the industry first.** Before designing anything, Claude researches the segment from predefined source
   types (trend press, colour forecasts, category specialists, materials, marketplace demand, competitors, kit and
   design rules), writes a sourced brief, and proposes design directions. You choose the directions.
2. **Designs from the research.** Complete, makeable designs using only the decoration methods your factory runs,
   checked for balance, manufacturability and IP problems.
3. **Photographs each design consistently.** One concept sheet per product shows every view side by side; after you
   approve it, each view is generated from that sheet at 2K, then detail, flat-lay, lifestyle and colourway images
   from the finished views. Size charts are typeset, never generated.
4. **Writes listings buyers find.** Alibaba titles, 15+ keyword phrases, attributes and sectioned descriptions; Etsy
   titles, 13 tags and phone-friendly descriptions, all from the research keyword bank and checked against each
   marketplace's rules.
5. **Submits safely.** Images are hosted on your Xelent dashboard; Etsy listings are created as **drafts** and
   Alibaba listings go into **Alibaba's review**. Nothing is published live. Without an Alibaba connection it
   writes Alibaba's bulk-upload spreadsheet instead.

Every stage has a gate: research approval, sheet approval, listing approval, and an explicit go-ahead to submit.

**Example** (one original teamwear design, generated with this skill): the approved concept sheet, then every
photograph drawn from it: four studio views, a detail close-up, a flat lay, a lifestyle shot and a second colourway.

![Concept sheet](docs/example-sheet.jpg)
![Product photographs from the approved sheet](docs/example-photos.jpg)

## Install

In Claude Code:

```
/plugin marketplace add Xelent143/xelent-product-studio
/plugin install xelent-product-studio@xelent-product-studio
```

Or copy `plugins/xelent-product-studio/skills/xelent-product-studio` into `~/.claude/skills/`.

Requirements: Node.js 18+, Python 3 with Pillow and openpyxl (`python3 -m pip install pillow openpyxl`).

## Set up Xelent API

1. Create an account at [xelentapi.com](https://xelentapi.com), add credits (1 credit = 1 image) and create an API
   key under **API keys**.
2. Ask Claude to set up the product studio; it saves the key with
   `node scripts/xelent.mjs login --key sk-...` (stored in `~/.config/xelent/credentials`, readable only by you).
3. Connect your stores under **Marketplaces** on the Xelent dashboard:
   - **Etsy**: create an app at [etsy.com/developers](https://www.etsy.com/developers/register) with the callback URL
     shown on the page, then enter its keystring and shared secret.
   - **Alibaba.com**: requires a Gold Supplier store. If Alibaba is not available for your account, the skill
     produces the bulk-upload spreadsheet instead.

## Use

Ask Claude in plain words, for example:

- "Research what's trending in custom football kits and design 8 new kits for my Alibaba store."
- "Make a streetwear capsule of 5 heavyweight hoodies and tees for Etsy with product photos and listings."
- "Photograph these BJJ gi designs from every angle and list them on Etsy as drafts."

## Cost

About 1 credit per image: a product with four views, three extras and two extra colourways is roughly 10 credits
plus any revisions. Claude tells you the count before each generation stage.

## Notes on marketplace rules

- The skill blocks brand, league, club, event and character names and unproven claims (certifications, waterproof
  ratings) in designs and listings.
- Etsy requires sellers to disclose AI use in creating items. The skill has a per-shop setting
  (`marketplaces.etsy.disclose_ai`, on by default) that adds a disclosure line to Etsy descriptions; if you turn it
  off, you accept Etsy's enforcement risk.

## Layout

```
plugins/xelent-product-studio/skills/xelent-product-studio/
  SKILL.md            the workflow Claude follows
  scripts/            xelent.mjs (API client) studio.py (workspace, gates) plan.py run.mjs board.py approve.py
                      size_chart.py prepare_images.py listing.py alibaba_xlsx.py publish.mjs
  references/         research playbook, design language, image direction, Alibaba and Etsy listing guides,
                      IP rules, studio.json schema, Xelent API
  evals/evals.json    test prompts
```

## License

MIT
