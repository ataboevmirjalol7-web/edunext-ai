/**
 * `/diagnostic` — sahifa yuklanganda avval holat tozalanadi, keyin modal diagnostika ilovasi mount qilinadi.
 */
(async () => {
  const [{ resetDiagnosticClientState }, { mountDiagnostic }] = await Promise.all([
    import("/diagnosticReset.mjs"),
    import("/diagnostic-app.mjs"),
  ]);
  const root = document.getElementById("dq-root");
  if (!root) return;
  try {
    await resetDiagnosticClientState();
  } catch (e) {
    console.warn("[diagnostic-test reset]", e);
  }
  mountDiagnostic(root, { embedded: false });
})();
