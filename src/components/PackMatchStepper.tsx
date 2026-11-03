"use client";

type Step = {
  n: 1 | 2 | 3 | 4;
  label: string;
};

type PackMatchStepperProps = {
  steps: Step[];
  activeStep: 1 | 2 | 3 | 4;
  onStep: (step: 1 | 2 | 3 | 4) => void;
};

/**
 * Stepper de 4 fases del flujo de conciliación.
 * Presentacional: recibe fases, fase activa y callback de navegación.
 */
export function PackMatchStepper({
  steps,
  activeStep,
  onStep,
}: PackMatchStepperProps) {
  return (
    <nav aria-label="Progreso del flujo de conciliación" className="bg-white border-b border-(--pm-border) sticky top-0 z-30">
      <div role="tablist" aria-label="Fases del flujo de trabajo" className="max-w-[1440px] mx-auto px-4 sm:px-6 flex items-stretch gap-1 overflow-x-auto">
        {steps.map((st) => {
          const isActive = activeStep === st.n;
          return (
            <button key={st.n} type="button" role="tab" aria-selected={isActive} aria-label={`Paso ${st.n}: ${st.label}`} onClick={() => onStep(st.n)} className={`btn-press flex items-center gap-2.5 px-4 py-3 whitespace-nowrap cursor-pointer border-b-[3px] ${isActive ? "border-(--pm-primary) bg-(--pm-selection)" : "border-transparent hover:bg-(--pm-paper)"}`}>
              <span className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-black shrink-0 ${isActive ? "bg-(--pm-primary) text-white" : "bg-(--pm-selection) text-(--pm-text-secondary)"}`}>{st.n}</span>
              <span className={`text-sm ${isActive ? "font-bold text-(--pm-ink)" : "text-(--pm-text-secondary)"}`}>{st.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
