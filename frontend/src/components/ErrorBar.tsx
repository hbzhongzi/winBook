import type { AppError } from "../utils/appError";

type Props = {
  error: AppError | null;
  onClose: () => void;
};

export default function ErrorBar({ error, onClose }: Props) {
  if (!error) return null;
  return (
    <div className="errorbar" role="alert">
      <span className="err-code">{error.code}</span>
      <span className="err-msg">{error.message}</span>
      <button type="button" className="err-close" onClick={onClose} aria-label="关闭提示">
        &#10005;
      </button>
    </div>
  );
}
