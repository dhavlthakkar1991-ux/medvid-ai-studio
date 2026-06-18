// Medical Template + Medical Specialty catalogs (MedVideo AI).
// Configuration-only: drives form defaults and is persisted on the project
// context. No pipeline branching is performed based on these values yet.

export type MedicalTemplate = {
  id: string;
  name: string;
  audience: string;
  brand_voice: string;
  visual_density: "low" | "medium" | "high";
  retention_priority: "low" | "medium" | "high" | "maximum";
  render_intent:
    | "youtube_education"
    | "patient_education"
    | "hospital_branding"
    | "ted_talk"
    | "netflix_doc"
    | "maximum_retention";
  focus: string;
};

export const MEDICAL_TEMPLATES: MedicalTemplate[] = [
  {
    id: "patient_education",
    name: "Patient Education",
    audience: "Patients",
    brand_voice: "Empathetic, Educational",
    visual_density: "medium",
    retention_priority: "high",
    render_intent: "youtube_education",
    focus: "Simple explanations, diagrams, symptom education, treatment understanding.",
  },
  {
    id: "disease_explainer",
    name: "Disease Explainer",
    audience: "Patients",
    brand_voice: "Educational",
    visual_density: "medium",
    retention_priority: "high",
    render_intent: "patient_education",
    focus: "Disease overview, causes, symptoms, diagnosis, treatment.",
  },
  {
    id: "treatment_explainer",
    name: "Treatment Explainer",
    audience: "Patients",
    brand_voice: "Educational + Reassuring",
    visual_density: "high",
    retention_priority: "high",
    render_intent: "patient_education",
    focus: "Treatment pathways, procedures, expectations.",
  },
  {
    id: "symptoms_warning_signs",
    name: "Symptoms & Warning Signs",
    audience: "Patients",
    brand_voice: "Awareness",
    visual_density: "medium",
    retention_priority: "maximum",
    render_intent: "maximum_retention",
    focus: "Early detection and red flags.",
  },
  {
    id: "screening_prevention",
    name: "Screening & Prevention",
    audience: "Patients",
    brand_voice: "Preventive",
    visual_density: "medium",
    retention_priority: "high",
    render_intent: "patient_education",
    focus: "Screening programs, prevention, lifestyle.",
  },
  {
    id: "faq_video",
    name: "FAQ Video",
    audience: "Patients",
    brand_voice: "Direct Q&A",
    visual_density: "medium",
    retention_priority: "high",
    render_intent: "youtube_education",
    focus: "Most common clinic questions.",
  },
  {
    id: "postoperative_care",
    name: "Postoperative Care",
    audience: "Patients",
    brand_voice: "Instructional",
    visual_density: "medium",
    retention_priority: "high",
    render_intent: "patient_education",
    focus: "Recovery, precautions, follow-up.",
  },
  {
    id: "clinical_update",
    name: "Clinical Update",
    audience: "Doctors",
    brand_voice: "Evidence Based",
    visual_density: "high",
    retention_priority: "medium",
    render_intent: "ted_talk",
    focus: "Latest evidence, guidelines, practice changes.",
  },
  {
    id: "journal_club",
    name: "Journal Club",
    audience: "Doctors",
    brand_voice: "Analytical",
    visual_density: "high",
    retention_priority: "medium",
    render_intent: "ted_talk",
    focus: "Paper review, trial analysis, discussion.",
  },
  {
    id: "case_discussion",
    name: "Case Discussion",
    audience: "Doctors",
    brand_voice: "Clinical",
    visual_density: "high",
    retention_priority: "medium",
    render_intent: "ted_talk",
    focus: "Case presentation, MDT discussion, management decisions.",
  },
  {
    id: "conference_presentation",
    name: "Conference Presentation",
    audience: "Doctors",
    brand_voice: "Academic",
    visual_density: "high",
    retention_priority: "medium",
    render_intent: "ted_talk",
    focus: "Conference summaries and presentations.",
  },
  {
    id: "webinar_repurposing",
    name: "Webinar Repurposing",
    audience: "Mixed",
    brand_voice: "Professional",
    visual_density: "high",
    retention_priority: "high",
    render_intent: "youtube_education",
    focus: "Long-form webinar conversion into educational content.",
  },
];

export type MedicalSpecialty = { id: string; name: string };

export const MEDICAL_SPECIALTIES: MedicalSpecialty[] = [
  { id: "general_medicine", name: "General Medicine" },
  { id: "surgical_oncology", name: "Surgical Oncology" },
  { id: "breast_oncology", name: "Breast Oncology" },
  { id: "gi_oncology", name: "GI Oncology" },
  { id: "head_neck_oncology", name: "Head & Neck Oncology" },
  { id: "thoracic_oncology", name: "Thoracic Oncology" },
  { id: "gynecologic_oncology", name: "Gynecologic Oncology" },
  { id: "urologic_oncology", name: "Urologic Oncology" },
  { id: "hematology_oncology", name: "Hematology Oncology" },
  { id: "cardiology", name: "Cardiology" },
  { id: "neurology", name: "Neurology" },
  { id: "neurosurgery", name: "Neurosurgery" },
  { id: "orthopedics", name: "Orthopedics" },
  { id: "ent", name: "ENT" },
  { id: "gastroenterology", name: "Gastroenterology" },
  { id: "pulmonology", name: "Pulmonology" },
  { id: "dermatology", name: "Dermatology" },
  { id: "endocrinology", name: "Endocrinology" },
  { id: "gynecology", name: "Gynecology" },
  { id: "ivf_reproductive_medicine", name: "IVF & Reproductive Medicine" },
  { id: "pediatrics", name: "Pediatrics" },
  { id: "radiology", name: "Radiology" },
  { id: "pathology", name: "Pathology" },
  { id: "general_surgery", name: "General Surgery" },
  { id: "plastic_surgery", name: "Plastic Surgery" },
  { id: "critical_care", name: "Critical Care" },
  { id: "family_medicine", name: "Family Medicine" },
];

export function findMedicalTemplate(id: string | null | undefined) {
  if (!id) return undefined;
  return MEDICAL_TEMPLATES.find((t) => t.id === id);
}

export function findMedicalSpecialty(id: string | null | undefined) {
  if (!id) return undefined;
  return MEDICAL_SPECIALTIES.find((s) => s.id === id);
}