import { CustomerMessage } from '@/components/customer/customer-message';

export default function CustomerNotFound() {
  return (
    <CustomerMessage
      title="Page not found"
      text="Please scan the QR code on your table again to open the menu."
    />
  );
}
