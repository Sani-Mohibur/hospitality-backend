import mongoose from 'mongoose';
import { tenantScopePlugin } from '../plugins/tenantScope.plugin';

// Must be imported before any model is compiled (first import in app.ts).
mongoose.set('transactionAsyncLocalStorage', true);
mongoose.set('strictQuery', true);
mongoose.plugin(tenantScopePlugin);

export default mongoose;
