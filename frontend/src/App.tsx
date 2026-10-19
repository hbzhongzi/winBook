import { useCallback, useState } from "react";
import { OpenBook } from "../wailsjs/go/main/App";
import { WindowSetTitle } from "../wailsjs/runtime/runtime";
import type { main } from "../wailsjs/go/models";
import Toolbar from "./components/Toolbar";
import ErrorBar from "./components/ErrorBar";
import BookViewer from "./components/BookViewer";
import StatusBar from "./components/StatusBar";
import { toAppError, type AppError } from "./utils/appError";

type Book = main.BookData;

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState("");

  // 打开图书：loading → 成功分派 / 取消静默 / 失败错误条（叠加态）
  const handleOpen = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await OpenBook();
      if (!result) return; // 用户取消：静默，不提示
      setBook(result);
      setDetail("");
      await WindowSetTitle("BookEditor — " + result.name);
    } catch (e) {
      const appError = toAppError(e);
      if (appError.code !== "USER_CANCELED") {
        setError(appError);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="app">
      <Toolbar book={book} loading={loading} onOpen={handleOpen} />
      <ErrorBar error={error} onClose={() => setError(null)} />
      <BookViewer book={book} onDetail={setDetail} />
      <StatusBar book={book} detail={detail} />
    </div>
  );
}
