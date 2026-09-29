export class PaymentService {
  async processPayment(amount: number): Promise<boolean> {
    if (amount <= 0) throw new Error("invalid");
    return true;
  }

  refreshToken(): string {
    return "tok";
  }
}

export function checkout() {
  return new PaymentService();
}
