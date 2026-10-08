// Headless: signs every function of the current program and queries an H2 BSim database for its nearest matches.
// Writes TSV rows: query name, query addr, query size, match exe, match name, match addr, similarity, significance.
//   -postScript QueryBSim.java /abs/path/db/NAME OUT.tsv [max=5] [thresh=0.5] [lo=0x..] [hi=0x..]
// @category BSim
import java.io.IOException;
import java.io.PrintWriter;
import java.util.*;

import ghidra.app.script.GhidraScript;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.description.*;
import ghidra.features.bsim.query.protocol.*;
import ghidra.program.model.listing.Function;

public class QueryBSim extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		int max = 5;
		double thresh = 0.5;
		long lo = 0, hi = Long.MAX_VALUE;
		for (int i = 2; i < args.length; i++) {
			if (args[i].startsWith("max=")) max = Integer.parseInt(args[i].substring(4));
			if (args[i].startsWith("thresh=")) thresh = Double.parseDouble(args[i].substring(7));
			if (args[i].startsWith("lo=")) lo = Long.decode(args[i].substring(3));
			if (args[i].startsWith("hi=")) hi = Long.decode(args[i].substring(3));
		}
		BSimServerInfo serverInfo = new BSimServerInfo(args[0] + BSimServerInfo.H2_FILE_EXTENSION);
		try (FunctionDatabase db = BSimClientFactory.buildClient(serverInfo, false);
				PrintWriter out = new PrintWriter(args[1])) {
			if (!db.initialize()) throw new IOException(db.getLastError().message);
			GenSignatures gensig = new GenSignatures(false);
			try {
				gensig.setVectorFactory(db.getLSHVectorFactory());
				gensig.openProgram(currentProgram, null, null, null, null, null);
				Map<Long, Function> byAddr = new HashMap<>();
				List<Function> funcs = new ArrayList<>();
				for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
					long a = f.getEntryPoint().getOffset();
					if (a < lo || a > hi || f.isThunk() || f.isExternal()) continue;
					funcs.add(f);
					byAddr.put(a, f);
				}
				println("SIGNING " + funcs.size());
				gensig.scanFunctions(funcs.iterator(), funcs.size(), monitor);
				DescriptionManager all = gensig.getDescriptionManager();
				List<FunctionDescription> descs = new ArrayList<>();
				all.listAllFunctions().forEachRemaining(descs::add);
				out.println("qname\tqaddr\tqsize\tmexe\tmname\tmaddr\tsim\tsignif");
				Set<Long> answered = new HashSet<>();
				int batch = 100;
				for (int i = 0; i < descs.size(); i += batch) {
					DescriptionManager part = new DescriptionManager();
					part.transferSettings(all);
					for (FunctionDescription fd : descs.subList(i, Math.min(descs.size(), i + batch))) {
						if (fd.getSignatureRecord() != null) part.transferFunction(fd, true);
					}
					QueryNearest q = new QueryNearest();
					q.manage = part;
					q.max = max;
					q.thresh = thresh;
					q.signifthresh = 0.0;
					ResponseNearest resp = q.execute(db);
					if (resp == null) throw new IOException(db.getLastError().message);
					for (SimilarityResult sim : resp.result) {
						FunctionDescription base = sim.getBase();
						Function f = byAddr.get(base.getAddress());
						long size = f == null ? 0 : f.getBody().getNumAddresses();
						answered.add(base.getAddress());
						if (sim.size() == 0) {
							out.printf("%s\t%x\t%d\t-\t-\t-\t0\t0%n", base.getFunctionName(), base.getAddress(), size);
						}
						for (SimilarityNote note : sim) {
							FunctionDescription m = note.getFunctionDescription();
							out.printf("%s\t%x\t%d\t%s\t%s\t%x\t%.4f\t%.2f%n", base.getFunctionName(),
								base.getAddress(), size, m.getExecutableRecord().getNameExec(),
								m.getFunctionName(), m.getAddress(), note.getSimilarity(), note.getSignificance());
						}
					}
					monitor.checkCancelled();
				}
				// functions without a usable signature (too small / failed decompile)
				for (FunctionDescription fd : descs) {
					if (answered.contains(fd.getAddress())) continue;
					Function f = byAddr.get(fd.getAddress());
					out.printf("%s\t%x\t%d\t-\t-\t-\t-1\t0%n", fd.getFunctionName(), fd.getAddress(),
						f == null ? 0 : f.getBody().getNumAddresses());
				}
				println("QUERIED " + descs.size());
			}
			finally {
				gensig.dispose();
			}
		}
	}
}
