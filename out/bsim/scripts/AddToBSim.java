// Headless: adds the current program's functions to an H2 BSim database (the program is only read).
//   -postScript AddToBSim.java /abs/path/db/NAME [lo=0x...] [hi=0x...]
// @category BSim
import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

import generic.lsh.vector.LSHVectorFactory;
import ghidra.app.script.GhidraScript;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.description.DatabaseInformation;
import ghidra.features.bsim.query.description.DescriptionManager;
import ghidra.features.bsim.query.protocol.*;
import ghidra.framework.model.DomainFile;
import ghidra.framework.protocol.ghidra.GhidraURL;
import ghidra.program.model.listing.Function;

public class AddToBSim extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		long lo = 0, hi = Long.MAX_VALUE;
		for (int i = 1; i < args.length; i++) {
			if (args[i].startsWith("lo=")) lo = Long.decode(args[i].substring(3));
			if (args[i].startsWith("hi=")) hi = Long.decode(args[i].substring(3));
		}
		BSimServerInfo serverInfo = new BSimServerInfo(args[0] + BSimServerInfo.H2_FILE_EXTENSION);
		try (FunctionDatabase db = BSimClientFactory.buildClient(serverInfo, false)) {
			if (!db.initialize()) throw new IOException(db.getLastError().message);
			DatabaseInformation info = db.getInfo();
			LSHVectorFactory vf = db.getLSHVectorFactory();
			GenSignatures gensig = new GenSignatures(info.trackcallgraph);
			try {
				gensig.setVectorFactory(vf);
				gensig.addExecutableCategories(info.execats);
				gensig.addFunctionTags(info.functionTags);
				gensig.addDateColumnName(info.dateColumnName);
				DomainFile dFile = currentProgram.getDomainFile();
				URL fileURL = dFile.getLocalProjectURL(null);
				String path = GhidraURL.getProjectPathname(fileURL);
				int lastSlash = path.lastIndexOf('/');
				path = lastSlash == 0 ? "/" : path.substring(0, lastSlash);
				String repo = GhidraURL.getProjectURL(fileURL).toExternalForm();
				gensig.openProgram(currentProgram, null, null, null, repo, path);
				List<Function> funcs = new ArrayList<>();
				for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
					long a = f.getEntryPoint().getOffset();
					if (a < lo || a > hi || f.isThunk() || f.isExternal()) continue;
					funcs.add(f);
				}
				println("SIGNING " + funcs.size() + " functions of " + currentProgram.getName());
				long t0 = System.currentTimeMillis();
				gensig.scanFunctions(funcs.iterator(), funcs.size(), monitor);
				DescriptionManager manager = gensig.getDescriptionManager();
				println("SIGNED " + manager.numFunctions() + " in " + (System.currentTimeMillis() - t0) / 1000 + " s");
				manager.listAllFunctions().forEachRemaining(fd -> fd.sortCallgraph());
				InsertRequest req = new InsertRequest();
				req.manage = manager;
				if (req.execute(db) == null) throw new IOException(db.getLastError().message);
				ResponseExe cnt = new QueryExeCount().execute(db);
				println("INSERTED " + currentProgram.getName() + "; database has " + cnt.recordCount + " executables");
			}
			finally {
				gensig.dispose();
			}
		}
	}
}
