type Props = {
  text: string;
};

export default function TextViewer({ text }: Props) {
  return (
    <section className="state state-txt active" aria-label="TXT 显示">
      <div className="txt-scroll">
        <pre className="txt-viewer">{text}</pre>
      </div>
    </section>
  );
}
