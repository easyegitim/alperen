import { describe, expect, it } from "vitest";
import { BEARD_PRESETS } from "@/content/beard-presets";
import { COLOR_PRESETS } from "@/content/color-presets";
import { EXERCISES } from "@/content/exercises";
import { AI_ALLOWED_SPECIALTIES } from "@/content/expert-specialties";
import { FACE_SHAPES } from "@/content/face-shapes";
import { HABITS } from "@/content/habits";
import { HAIR_PRESETS } from "@/content/hair-presets";
import { ALL_PRESETS, visiblePresets } from "@/content/presets";
import { SKIN_STEPS } from "@/content/skin-steps";

const SPRINT2_IDS = `amerikan_tirasi asker_tirasi erkek_perma seyrek_sac_dokulu_kisa french_bob a_line_bob layered_shoulder side_swept_bangs half_up_bun low_bun_sleek chocolate_brown cool_dark_brown caramel_balayage honey_blonde copper_red platinum_blonde`.split(/\s+/);
const SPEC_IDS = `textured_crop french_crop buzz_cut crew_cut caesar burst_fade low_taper mid_fade high_fade side_part_classic side_part_fade quiff pompadour slick_back_short slick_back_long ivy_league faux_hawk undercut two_block_korean curtain_bangs_men middle_part_flow mid_length_wavy messy_textured_top curly_top_fade afro_taper shoulder_length man_bun modern_mullet wolf_cut edgar_soft long_layers curtain_bangs bob_classic lob pixie shag butterfly_cut blunt_bangs beach_waves sleek_straight_long curly_defined high_ponytail darker_natural lighter_brown ash_blonde jet_black auburn silver_gray clean_shaven stubble_light stubble_heavy short_boxed full_medium full_long goatee van_dyke chin_strap anchor mustache_classic faded_beard`.split(/\s+/);

describe("kataloglar (SPEC 9.3, 10.2)", () => {
  it("76 preset: SPEC 60 (30 erkek + 12 kadın saç, 12 sakal, 6 renk) + PLAN 4e genişletme (4 uzman, 6 kadın, 6 renk); id'ler birebir", () => {
    expect(HAIR_PRESETS).toHaveLength(52);
    expect(HAIR_PRESETS.filter((p) => p.presentation?.includes("male"))).toHaveLength(34);
    expect(HAIR_PRESETS.filter((p) => p.presentation?.includes("female"))).toHaveLength(18);
    expect(BEARD_PRESETS).toHaveLength(12);
    expect(COLOR_PRESETS).toHaveLength(12);
    expect(ALL_PRESETS.map((p) => p.id).sort()).toEqual([...SPEC_IDS, ...SPRINT2_IDS].sort());
    expect(new Set(ALL_PRESETS.map((p) => p.id)).size).toBe(ALL_PRESETS.length);
    expect(visiblePresets()).toHaveLength(ALL_PRESETS.length); // kapı koşusu yapılmadı: gizli stil yok
    expect(HAIR_PRESETS.filter((p) => p.tags?.includes("expert")).map((p) => p.id)).toEqual(["amerikan_tirasi", "asker_tirasi", "erkek_perma", "seyrek_sac_dokulu_kisa"]);
  });
  it("her preset: İngilizce prompt, koruma bölgesi, en az bir uygun şekil; sakal istemleri yanak/favori/boynu adıyla söyler (PLAN 5a)", () => {
    for (const p of ALL_PRESETS) {
      expect(p.prompt.length).toBeGreaterThan(10);
      expect(p.suits.length).toBeGreaterThan(0);
      // Sakal: features_cheeks (yanak, favori, çene altı, bıyık modele kalır); saç/renk: below_brows.
      expect(p.protect, p.id).toBe(p.kind === "beard" ? "features_cheeks" : "below_brows");
    }
    for (const b of BEARD_PRESETS) {
      expect(b.prompt, b.id).toMatch(/cheek/);
      expect(b.prompt, b.id).toMatch(/neck/);
      expect(b.prompt, b.id).toMatch(/sideburn|jawline/);
    }
    expect(BEARD_PRESETS.filter((b) => b.tags?.includes("growth")).length).toBeGreaterThanOrEqual(5);
  });
  it("8 egzersiz SPEC 9.5 id'leriyle; cilt adımlarında marka yok; 7 alışkanlık", () => {
    expect(EXERCISES.map((e) => e.id)).toEqual(["ex_masseter_gum", "ex_chin_tuck", "ex_neck_stretch", "ex_cheek_puff", "ex_fish_face", "ex_jaw_release", "ex_face_massage", "ex_brow_relax"]);
    expect(SKIN_STEPS.length).toBeGreaterThanOrEqual(10);
    // SPEC 9.3 yedi alışkanlık + Sprint 2 genişletmesi (PLAN 4e): beş hijyen/duruş alışkanlığı
    expect(HABITS).toHaveLength(12);
    for (const id of ["hb_water", "hb_sleep", "hb_sun", "hb_walk", "hb_protein", "hb_strength", "hb_salt_alcohol"]) expect(HABITS.some((h) => h.id === id), id).toBe(true);
  });
  it("her yüz şekli için en az 3 saç ve 3 sakal önerisi var", () => {
    for (const s of Object.values(FACE_SHAPES)) {
      expect(s.hairIds.length).toBeGreaterThanOrEqual(3);
      expect(s.beardIds.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("AI plastik cerrahi önermez (D11)", () => {
    expect(AI_ALLOWED_SPECIALTIES).not.toContain("plastik_cerrahi");
    expect(AI_ALLOWED_SPECIALTIES).toContain("dermatoloji");
  });
});
