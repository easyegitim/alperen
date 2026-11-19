const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const uploadZone = document.getElementById("upload-zone");
const modal = document.getElementById("report-modal");
const generateReport = document.getElementById("generate-report");
const closeModal = document.getElementById("close-modal");
const newReportButton = document.getElementById("new-report");

const sampleFiles = [
  "Deneme-1-Mart.xlsx",
  "Deneme-2-Nisan.pdf",
  "Öğrenci-Sonuçları.xlsx",
];

const renderFiles = (files) => {
  fileList.innerHTML = "";
  files.forEach((fileName) => {
    const item = document.createElement("li");
    item.textContent = fileName;
    fileList.appendChild(item);
  });
};

const handleFiles = (files) => {
  const list = [...files].map((file) => file.name);
  if (list.length === 0) return;
  renderFiles(list);
};

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("active");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("active");
});

uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("active");
  handleFiles(event.dataTransfer.files);
});

fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
});

const openModal = () => {
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
};

const closeModalAction = () => {
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
};

generateReport.addEventListener("click", openModal);
newReportButton.addEventListener("click", openModal);
closeModal.addEventListener("click", closeModalAction);
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModalAction();
  }
});

renderFiles(sampleFiles);
