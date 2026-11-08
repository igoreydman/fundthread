import { useRef, useState } from "react";
import {
  ArrowRight,
  FileImage,
  FileText,
  FolderOpen,
  LockKeyhole,
  UploadCloud,
} from "lucide-react";
import { Modal } from "./Modal";
export function ImportReceipts({
  sample,
  initialFiles = [],
  onFiles,
  onClose,
}: {
  sample: boolean;
  initialFiles?: File[];
  onFiles: (files: File[]) => Promise<void>;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState(initialFiles);
  return (
    <Modal
      title="Bring a receipt. Keep control."
      subtitle="Read a photo, scan or PDF right here in your browser."
      onClose={onClose}
    >
      <div className="modal-content import-content">
        <div className="import-privacy">
          <span>
            <LockKeyhole size={19} />
          </span>
          <div>
            <strong>Processed on this device</strong>
            <p>
              Receipt files stay in this tab. They are not sent to a
              document-processing service.
            </p>
          </div>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          aria-label="Choose receipt files"
          onChange={(e) => {
            const chosen = Array.from(e.target.files || []);
            if (chosen.length) void onFiles(chosen);
          }}
        />
        <button
          className={`receipt-dropzone ${over ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            setFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => input.current?.click()}
        >
          <span className="dropzone-papers">
            <FileImage size={28} />
            <FileText size={28} />
          </span>
          <strong>Choose photos or PDFs</strong>
          <span>or drop them here</span>
          <small>JPEG, PNG or PDF · up to 20 MB each · English OCR</small>
          <span className="button secondary">
            <FolderOpen size={15} />
            Browse files
          </span>
        </button>
        {files.length > 0 && (
          <div className="import-staged">
            <span>
              {files.length} file{files.length === 1 ? "" : "s"} ready
            </span>
            <button
              className="button primary"
              onClick={() => void onFiles(files)}
            >
              Import selected receipts
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        <div className="import-session-note">
          <strong>
            {sample
              ? "Your receipts get their own space."
              : "This is a temporary workspace."}
          </strong>
          <p>
            {sample
              ? "Choosing files starts an empty receipt workspace, separate from the fictional Tidepath sample."
              : "Add more receipts to the current browser session."}{" "}
            Download the outputs you need before closing or reloading. A desktop
            database workspace has separate storage and recovery
            responsibilities.
          </p>
        </div>
      </div>
    </Modal>
  );
}
