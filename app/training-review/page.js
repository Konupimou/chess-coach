import TrainingReviewClient from "./training-review-client.js";

export const metadata = {
  title: "Coach-Training Review",
  description: "Kuratierungsoberfläche für Stockfish-belegte Coach-Erklärungen.",
};

export default function TrainingReviewPage() {
  return <TrainingReviewClient />;
}
