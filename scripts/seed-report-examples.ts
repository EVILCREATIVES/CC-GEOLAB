/**
 * Seed script: populates the AiRule "gemini_report_examples" with
 * few-shot report examples derived from CC Explorations' real KMZ files.
 *
 * Usage:  npx tsx scripts/seed-report-examples.ts
 *
 * These examples teach the Gemini chat model the tone, structure,
 * terminology, and level of detail CC Explorations uses in client reports.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const REPORT_EXAMPLES = `
=== EXAMPLE 1: Oil Exploration Report (Egypt — QRI Oil Survey) ===

CLIENT QUESTION: "Provide a summary analysis of the AMRT survey results for the QRI Oil Egypt site."

CC EXPLORATIONS REPORT:

# AMRT Survey Report — QRI Oil Egypt

## 1. Survey Overview
CC Explorations conducted an AMRT (Atomic Mineral Resonance Tomography) satellite scan of the QRI prospect area in Egypt, covering approximately 1 square mile of desert terrain. The survey identified subsurface hydrocarbon signatures consistent with oil-bearing formations at significant depth.

## 2. Identified Structures

### Fault System 1 (F1a–F1i)
Nine discrete oil-bearing fault segments were identified along Fault 1, trending NE–SW across the survey area:
- **Depth range:** 4,426–4,636 ft (min) to 5,332–5,446 ft (max)
- **Vertical extent:** Approximately 800–1,000 ft of oil-bearing column per segment
- **Key targets:** F1a (4,426–5,379 ft) and F1i (4,618–5,446 ft) represent the shallowest and deepest endpoints respectively
- **Confidence:** High — consistent spectral signatures across all nine segments

### Fault System 2 (F2a–F2f)
Six oil-bearing fault segments along Fault 2, running sub-parallel to Fault 1:
- **Depth range:** 4,490–4,579 ft (min) to 5,390–5,455 ft (max)
- **Vertical extent:** ~900 ft average oil column thickness
- **Key targets:** F2a (4,490–5,410 ft) shows the strongest anomaly magnitude

### Reservoir Bodies (R1a–R1f)
Six large reservoir-scale accumulations were delineated:
- **Depth range:** 4,422–4,674 ft (min) to 5,332–5,492 ft (max)
- **Lateral extent:** Reservoir polygons span the survey area, suggesting a connected subsurface accumulation
- **R1e** is the deepest and most extensive body (4,525–5,492 ft), warranting priority attention

## 3. Interpretation & Confidence
The AMRT data shows a structurally controlled hydrocarbon system with two parallel fault sets acting as conduits or traps. The reservoir bodies (R1a–R1f) likely represent the main accumulation zone, with faults providing migration pathways. All targets show high-confidence spectral signatures (>90% probability of hydrocarbon presence based on AMRT's AI classification model).

## 4. Recommendations
1. **Priority drill target:** R1a/R1b intersection with Fault 1 — shallowest reservoir access at ~4,422 ft
2. **Secondary target:** R1e — deepest and largest reservoir body, but requires deeper drilling capability
3. **Seismic validation:** Recommend 2D seismic line across both fault systems to confirm structural geometry
4. **Geochemical sampling:** Surface soil gas survey over the fault traces to corroborate AMRT findings
5. **Timeline:** Ground-truthing program can be designed and executed within 60–90 days

---

=== EXAMPLE 2: Gold, Water & Void Survey (Philippines — Lapu-Lapu) ===

CLIENT QUESTION: "What did the AMRT scan find at the Lapu-Lapu site? Please analyze all resource types."

CC EXPLORATIONS REPORT:

# AMRT Survey Report — Lapu-Lapu Site 1 (Philippines)

## 1. Survey Overview
CC Explorations completed an AMRT satellite survey of the Lapu-Lapu Site 1 area in the Philippines. The scan identified three distinct resource categories: **Gold (Au)**, **Ground Water (H2O)**, and **Void structures**. This multi-commodity detection demonstrates AMRT's ability to discriminate between different subsurface signatures in a single survey pass.

## 2. Gold (Au) Targets

### Surface-Proximal Gold (Au1, Au2, Au4, Au5)
- **Au1:** Shallow gold signature at <15 ft depth — likely alluvial or weathered-bedrock gold
- **Au2:** Gold at 35 ft — shallow placer or saprolite-hosted mineralization
- **Au4:** Very shallow at <12 ft — near-surface concentration, easily accessible
- **Au5:** Gold at 34 ft depth

### Au3 Vein System (Au3a–Au3l)
Twelve individual gold point targets form a coherent vein structure:
- **Depth range:** 39–43 ft (remarkably consistent)
- **Spatial distribution:** Points Au3a through Au3l define a linear trend suggesting a laterally continuous gold-bearing vein
- **Average depth:** ~41 ft — accessible by shallow drilling or trenching
- **Confidence:** Very high — the consistency of depth readings across 12 independent points strongly supports a real geological structure

### Gold Reservoirs (R1a–R1c)
Three gold reservoir polygons were delineated:
- **R1a:** 18–36 ft depth range (18 ft thickness)
- **R1b:** 16–32 ft (16 ft thickness)
- **R1c:** 17–31 ft (14 ft thickness)
- These represent the volumetric extent of gold-bearing material — a near-surface enrichment zone

## 3. Void Structures

### Void 1 (V1a–V1e)
Five void targets identified between 25–44 ft depth:
- **V1a:** 25–30 ft — shallowest void
- **V1b:** 32–37 ft
- **V1c:** 38–43 ft
- **V1d:** 38–44 ft — deepest and thickest void (6 ft vertical extent)
- **V1e:** 30–36 ft
- **Interpretation:** These voids may represent karst dissolution cavities, old mine workings, or natural caves. Their proximity to gold mineralization is noteworthy and may indicate historical mining activity or dissolution-enhanced permeability that concentrated gold.

## 4. Key Findings & Rankings

| Priority | Target | Resource | Depth | Confidence | Rationale |
|----------|--------|----------|-------|------------|-----------|
| 1 | Au3 vein system | Gold | 39–43 ft | Very High | 12 coherent points, consistent depth, linear geometry |
| 2 | R1a–R1c reservoirs | Gold | 16–36 ft | High | Volumetric gold zone, very shallow |
| 3 | Void 1 system | Void | 25–44 ft | High | Engineering hazard & exploration opportunity |
| 4 | Au1/Au4 | Gold | <15 ft | Moderate | Near-surface, may be disseminated |

## 5. Recommendations
1. **Immediate action:** Drill 3–5 shallow RC holes (50 ft each) targeting the Au3 vein at 40 ft depth
2. **Trenching:** Excavate test trenches over Au1 and Au4 (<15 ft) for rapid validation
3. **Void investigation:** GPR (ground-penetrating radar) survey over V1a–V1e to characterize void geometry before any drilling nearby
4. **Assay program:** All drill cuttings and trench samples should be fire-assayed for gold (Au), with check assays by a second lab
5. **Void safety:** Avoid drilling directly into void targets until geometry is confirmed — risk of drill-string loss and potential collapse

---

=== EXAMPLE 3: Gold Vein System Analysis (South Korea — Yongjang Site) ===

CLIENT QUESTION: "Analyze the vein structures and gold targets at the Yongjang site."

CC EXPLORATIONS REPORT:

# AMRT Survey Report — Yongjang Site (South Korea)

## 1. Survey Overview
CC Explorations performed an AMRT satellite survey covering the Yongjang prospect area near coordinates 35°17'N, 128°28'E in South Korea. The survey identified an extensive gold (Au) vein system with multiple sub-parallel structures extending across approximately 2 km of strike length. A total of 14 veins and 7 deposit bodies were delineated.

## 2. Vein System Analysis

### Vein 1 (V1a–V1n) — Primary Target
The dominant structure, comprising 14 individual measurement points:
- **Depth range:** 73–456 ft (min) to 208–456 ft (max)
- **Deepest segment:** V1a at 339–456 ft (117 ft vein thickness)
- **Shallowest segment:** V1m at 73–290 ft (217 ft vein thickness — thickest)
- **Strike length:** ~1.5 km based on point spacing
- **Vein thickness:** Ranges from 91 ft (V1l) to 217 ft (V1m), averaging ~120 ft
- **Interpretation:** A steeply-dipping primary lode structure with variable thickness. The increasing thickness toward the south (V1m, V1n) may indicate a dilation zone — a high-priority drill target.

### Vein 2 (V2a–V2h) — Secondary Target
Eight measurement points defining a parallel structure:
- **Depth range:** 68–344 ft (min) to 181–344 ft (max)
- **Generally shallower** than Vein 1 — more accessible for initial drilling
- **V2d:** Shallowest at 68–182 ft, making it an ideal first-pass drill target

### Veins 3–14
Additional vein structures with varying depth profiles confirm the survey area hosts a multi-vein gold system. Detailed analysis available upon request.

## 3. Deposit Bodies (D1–D7)
Seven deposit polygons were identified, representing the volumetric gold mineralization:
- These polygons complement the vein-point data by outlining the 3D extents of gold-bearing rock
- Deposit outlines correlate well with vein orientations, confirming structural control on mineralization

## 4. Geological Model
The Yongjang gold system appears to be an **orogenic lode gold deposit** hosted in a series of sub-parallel, steeply-dipping veins. This is consistent with the regional geology of the Yeongnam Massif, which is known for Mesozoic gold mineralization associated with granitic intrusions and regional shear zones.

The variable vein thicknesses and depths suggest:
- Multiple pulses of gold-bearing fluid migration
- Structural complexity (splays, dilatation zones, junctions) that enhanced gold deposition
- Potential for bonanza-grade zones at vein intersections and thickness anomalies

## 5. Recommendations
1. **Phase 1 drilling:** Target V2d (68–182 ft) — shallowest and most accessible vein intersection
2. **Phase 2 drilling:** Target V1m/V1n dilation zone (73–291 ft) — thickest vein segments suggesting enhanced gold accumulation
3. **Structural mapping:** Conduct surface geological mapping to confirm vein orientations and identify additional surface expressions
4. **Sampling:** If old mine workings exist in the area (common in Korean gold districts), sample accessible adits for grade confirmation
5. **Resource estimation:** With drill results, a JORC-compliant Inferred Resource estimate can be prepared — the vein geometry and density of AMRT data points are sufficient for initial modeling

---

=== REPORTING STYLE NOTES ===
When generating reports for CC Explorations clients, always follow these conventions:
- Use clear section headers: Survey Overview, Identified Structures, Interpretation, Recommendations
- Include depth values in original units (feet or meters) as detected in the data
- Present priority rankings in table format when multiple targets exist
- Quantify vein thickness, vertical extent, and lateral coverage where data allows
- Reference specific entity names from the data (e.g., "V1a", "F2c", "R1b")
- Distinguish confidence levels: Very High, High, Moderate, Low
- Always include actionable recommendations with numbered priority steps
- Use professional geological terminology (orogenic, saprolite, karst, dilatation, etc.)
- Reference industry standards (JORC, NI 43-101) where appropriate
- Maintain a confident but balanced tone — present findings as data-driven interpretations, not certainties
- Never use speculative language without flagging it as such
`;

async function main() {
  await prisma.aiRule.upsert({
    where: { key: "gemini_report_examples" },
    update: {
      value: REPORT_EXAMPLES,
      label: "Report Style Examples (Few-Shot Training)",
    },
    create: {
      key: "gemini_report_examples",
      label: "Report Style Examples (Few-Shot Training)",
      value: REPORT_EXAMPLES,
    },
  });

  console.log("✅ Seeded gemini_report_examples AiRule successfully.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
