window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("ask-btn").addEventListener("click", () => {
    const res = confirm("Continue?");
    document.getElementById("result").textContent = String(res);
  });
});
